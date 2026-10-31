import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { BaseError, ContractFunctionRevertedError, defineChain, getAddress, keccak256 } from "viem";
import { AgreementStatus, AnchorTransactionStatus, MembershipRole, Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import type { OrganizationAuthContext } from "../agreements/agreement.types.js";
import { agreementRegistryAbi } from "./agreement-registry.abi.js";
import { BlockchainNetworkService } from "./blockchain-network.service.js";
import { evaluateAgreementConfirmation, loadAgreementApproval } from "./agreement-confirmation.js";
import { resolveAnchorRecovery } from "./anchor-recovery.js";

const leaseMs = 60_000;
const pollMs = 15_000;
const replacementSearchDepth = 128n;

type WorkerIntent = Prisma.AnchorIntentGetPayload<{ include: { snapshot: { include: { signatures: true } } } }>;
const recoverableStatuses = [AnchorTransactionStatus.QUEUED, AnchorTransactionStatus.SUBMISSION_UNCERTAIN, AnchorTransactionStatus.SUBMITTED, AnchorTransactionStatus.REPLACED];

@Injectable()
export class AgreementAnchoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgreementAnchoringService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly prisma: PrismaService, private readonly blockchain: BlockchainNetworkService) {}

  onModuleInit(): void {
    if (!this.blockchain.isAnchorConfigured()) return;
    this.timer = setInterval(() => void this.processPendingIntents(), pollMs);
    this.timer.unref();
    void this.processPendingIntents();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async processPendingIntents(): Promise<void> {
    if (this.running || !this.blockchain.isAnchorConfigured()) return;
    this.running = true;
    try {
      const processedIntentIds: string[] = [];
      for (let count = 0; count < 10; count += 1) {
        const claimed = await this.claimNextIntent(processedIntentIds);
        if (!claimed) break;
        processedIntentIds.push(claimed.id);
        try {
          await this.processIntent(claimed.id, claimed.leaseOwner);
        } catch (error) {
          this.logger.warn(`Agreement anchor processing failed (${this.errorClass(error)}; errorTypes=${this.errorTypeChain(error)}${this.errorCode(error)}${this.databaseErrorCode(error)}).`);
          await this.releaseAfterFailure(claimed.id, claimed.leaseOwner, error);
          break;
        }
      }
    } catch (error) {
      this.logger.error(`Agreement anchor polling failed (${this.errorClass(error)}; errorTypes=${this.errorTypeChain(error)}${this.errorCode(error)}${this.databaseErrorCode(error)}).`);
    } finally {
      this.running = false;
    }
  }

  async getStatus(context: OrganizationAuthContext, agreementId: string) {
    const agreement = await this.prisma.agreement.findUnique({
      where: { id: agreementId },
      select: { id: true, version: true, ownerOrganizationId: true, status: true, signatureStatus: true, blockchainStatus: true }
    });
    if (!agreement) throw new NotFoundException("Agreement not found.");
    await this.requireParticipant(context, agreement);
    const snapshot = await this.prisma.signingSnapshot.findUnique({
      where: { agreementId_version: { agreementId, version: agreement.version } },
      include: { anchorIntent: { select: { status: true, attemptCount: true, transactionHash: true, replacementHash: true, lastError: true, submittedAt: true, confirmedAt: true } } }
    });
    return {
      agreementId,
      version: agreement.version,
      agreementStatus: agreement.status,
      signatureStatus: agreement.signatureStatus,
      blockchainStatus: agreement.blockchainStatus,
      anchor: snapshot?.anchorIntent ?? null
    };
  }

  async retry(context: OrganizationAuthContext, agreementId: string) {
    if (context.organization.role === MembershipRole.MEMBER) throw new ForbiddenException("Only an organization OWNER or ADMIN can retry anchoring.");
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Agreement" WHERE "id" = ${agreementId}::uuid FOR UPDATE`;
      const agreement = await transaction.agreement.findFirst({
        where: { id: agreementId, ownerOrganizationId: context.organization.id },
        select: { id: true, version: true, status: true }
      });
      if (!agreement) throw new NotFoundException("Agreement not found.");
      const snapshot = await transaction.signingSnapshot.findUnique({
        where: { agreementId_version: { agreementId, version: agreement.version } },
        select: { id: true }
      });
      if (!snapshot) throw new ConflictException("The agreement has no frozen signing snapshot.");
      const existingIntent = await transaction.anchorIntent.findUnique({
        where: { snapshotId: snapshot.id },
        select: { id: true, status: true, relayerNonce: true, signedTransaction: true, lastError: true }
      });
      const canRetryPreparedTransaction = existingIntent?.status === AnchorTransactionStatus.FAILED
        && existingIntent.lastError === "rpc_rejected"
        && existingIntent.relayerNonce !== null
        && existingIntent.signedTransaction !== null;
      const canRetryUnpreparedIntent = existingIntent?.status === AnchorTransactionStatus.FAILED
        && existingIntent.relayerNonce === null
        && existingIntent.signedTransaction === null;
      if (!existingIntent || (!canRetryPreparedTransaction && !canRetryUnpreparedIntent)) {
        throw new ConflictException("Only a failed anchor attempt that can safely reuse its existing operation can be retried.");
      }
      const retryStatus = canRetryPreparedTransaction ? AnchorTransactionStatus.SUBMISSION_UNCERTAIN : AnchorTransactionStatus.QUEUED;
      const changed = await transaction.anchorIntent.updateMany({
        where: { id: existingIntent.id, status: AnchorTransactionStatus.FAILED },
        data: {
          status: retryStatus,
          submittedAt: null,
          lastError: null,
          leaseOwner: null,
          leaseUntil: null
        }
      });
      if (changed.count !== 1) throw new ConflictException("Only a failed anchor attempt can be retried.");
      const updatedAgreement = await transaction.agreement.updateMany({ where: { id: agreementId, version: agreement.version, status: AgreementStatus.ANCHOR_FAILED }, data: { status: AgreementStatus.ANCHOR_PENDING, blockchainStatus: retryStatus } });
      if (updatedAgreement.count !== 1) throw new ConflictException("The agreement changed before retry admission.");
      await transaction.auditEvent.create({
        data: {
          actorUserId: context.user.id,
          organizationId: context.organization.id,
          resourceType: "agreement",
          resourceId: agreementId,
          action: "agreement.anchor.retry_requested",
          metadata: { version: agreement.version }
        }
      });
      return { agreementId, version: agreement.version, blockchainStatus: retryStatus };
    });
  }

  async verifyAgreement(context: OrganizationAuthContext, agreementId: string) {
    const agreement = await this.prisma.agreement.findUnique({
      where: { id: agreementId },
      select: { id: true, version: true, ownerOrganizationId: true, status: true, blockchainStatus: true }
    });
    if (!agreement) throw new NotFoundException("Agreement not found.");
    await this.requireParticipant(context, agreement);
    const snapshot = await this.prisma.signingSnapshot.findUnique({
      where: { agreementId_version: { agreementId, version: agreement.version } },
      include: { anchorIntent: true, signatures: true }
    });
    if (!snapshot || snapshot.invalidatedAt) return { agreementId, version: agreement.version, verified: false, durableConfirmed: false, reason: "no_active_snapshot" };
    let proof;
    try {
      const { client, chainId, registryAddress } = await this.blockchain.getSigningContext();
      proof = await evaluateAgreementConfirmation(client, chainId, registryAddress, this.blockchain.getConfirmationCount(), snapshot, snapshot.anchorIntent);
    } catch {
      return { agreementId, version: agreement.version, verified: false, durableConfirmed: false, reason: "rpc_unavailable", proofStatus: "RETRYABLE_RPC_ERROR" };
    }
    return {
      agreementId, version: agreement.version, verified: proof.outcome === "CONFIRMABLE",
      durableConfirmed: agreement.status === AgreementStatus.ANCHOR_CONFIRMED && agreement.blockchainStatus === AnchorTransactionStatus.CONFIRMED && snapshot.anchorIntent?.status === AnchorTransactionStatus.CONFIRMED,
      reason: proof.reason, proofStatus: proof.outcome, confirmations: proof.confirmations,
      requiredConfirmations: proof.requiredConfirmations, receiptBlock: proof.receiptBlock, evaluatedHead: proof.evaluatedHead,
      transactionHash: proof.transactionHash ?? snapshot.anchorIntent?.transactionHash ?? null
    };
  }

  private async claimNextIntent(processedIntentIds: string[]) {
    const leaseOwner = randomUUID();
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string; now: Date }>>`
        SELECT "id", clock_timestamp() AS now FROM "AnchorIntent"
        WHERE "status" IN ('QUEUED'::"AnchorTransactionStatus", 'SUBMISSION_UNCERTAIN'::"AnchorTransactionStatus", 'SUBMITTED'::"AnchorTransactionStatus", 'REPLACED'::"AnchorTransactionStatus")
          AND ("leaseUntil" IS NULL OR "leaseUntil" < clock_timestamp())
          ${processedIntentIds.length ? Prisma.sql`AND "id" NOT IN (${Prisma.join(processedIntentIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.empty}
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      const intent = rows[0];
      if (!intent) return null;
      await transaction.anchorIntent.update({
        where: { id: intent.id },
        data: { leaseOwner, leaseUntil: new Date(intent.now.getTime() + leaseMs), attemptCount: { increment: 1 } }
      });
      return { id: intent.id, leaseOwner };
    });
  }

  private async processIntent(intentId: string, leaseOwner: string): Promise<void> {
    const intent = await this.prisma.anchorIntent.findFirst({
      where: { id: intentId, leaseOwner },
      include: {
        snapshot: {
          include: { signatures: true }
        }
      }
    });
    if (!intent) return;
    const { client, chainId, registryAddress, rpcUrl } = await this.blockchain.getSigningContext();
    const snapshot = intent.snapshot;
    const proof = await evaluateAgreementConfirmation(client, chainId, registryAddress, this.blockchain.getConfirmationCount(), snapshot, intent);
    if (proof.outcome === "CONFIRMABLE") return this.transition(intent, leaseOwner, AnchorTransactionStatus.CONFIRMED, null);
    if (proof.outcome === "FINAL_REVERT") return this.transition(intent, leaseOwner, AnchorTransactionStatus.FAILED, proof.reason);
    if (proof.outcome === "RECONCILIATION_REQUIRED") return this.transition(intent, leaseOwner, AnchorTransactionStatus.RECONCILIATION_REQUIRED, proof.reason);
    if (proof.outcome === "PENDING_DEPTH" || proof.outcome === "RETRYABLE_RPC_ERROR" || !proof.canPrepare && !proof.canRecover) {
      return this.transition(intent, leaseOwner, intent.status, proof.reason);
    }
    if (proof.canRecover) {
      const pendingNonce = await client.getTransactionCount({ address: intent.relayerAddress as `0x${string}`, blockTag: "pending" });
      const latestNonce = await client.getTransactionCount({ address: intent.relayerAddress as `0x${string}`, blockTag: "latest" });
      if (pendingNonce > Number(intent.relayerNonce) && latestNonce <= Number(intent.relayerNonce)) {
        return this.transition(intent, leaseOwner, AnchorTransactionStatus.SUBMISSION_UNCERTAIN, "replacement_pending_unknown");
      }
      if (latestNonce > Number(intent.relayerNonce)) {
        const latestBlock = await client.getBlockNumber({ cacheTime: 0 });
        const firstBlock = latestBlock > replacementSearchDepth ? latestBlock - replacementSearchDepth : 0n;
        for (let blockNumber = latestBlock; blockNumber >= firstBlock; blockNumber -= 1n) {
          const block = await client.getBlock({ blockNumber, includeTransactions: true });
          const replacement = block.transactions.find((tx) => typeof tx !== "string" && getAddress(tx.from) === getAddress(intent.relayerAddress!) && tx.nonce === Number(intent.relayerNonce));
          if (!replacement || typeof replacement === "string") continue;
          return this.transition(intent, leaseOwner, replacement.hash === intent.transactionHash ? AnchorTransactionStatus.SUBMITTED : AnchorTransactionStatus.REPLACED, "replacement_discovered",
            replacement.hash === intent.transactionHash ? {} : { replacementHash: replacement.hash });
        }
        return this.transition(intent, leaseOwner, proof.canRebroadcast ? AnchorTransactionStatus.RECONCILIATION_REQUIRED : intent.status, "nonce_consumed_without_proof");
      }
      if (!proof.canRebroadcast) return this.transition(intent, leaseOwner, intent.status, "receipt_pending");
      if (resolveAnchorRecovery({ registry: "missing", receipt: "missing", transaction: "missing", pendingNonce: BigInt(pendingNonce), relayerNonce: intent.relayerNonce! }) === "MANUAL_RECONCILIATION") {
        return this.transition(intent, leaseOwner, AnchorTransactionStatus.RECONCILIATION_REQUIRED, "nonce_consumed_without_proof");
      }
      const admitted = await this.prisma.$transaction(async (tx) => Boolean(await this.lockOwned(tx, intent, leaseOwner)));
      if (!admitted) return;
      const hash = await client.sendRawTransaction({ serializedTransaction: intent.signedTransaction as `0x${string}` });
      if (hash.toLowerCase() !== intent.transactionHash!.toLowerCase()) return this.transition(intent, leaseOwner, AnchorTransactionStatus.RECONCILIATION_REQUIRED, "rpc_transaction_hash_mismatch");
      return this.transition(intent, leaseOwner, AnchorTransactionStatus.SUBMITTED, null);
    }

    const account = this.blockchain.getRelayerAccount();
    const chain = defineChain({
      id: chainId,
      name: `SLA-DEX chain ${chainId}`,
      nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } }
    });
    const approval = await loadAgreementApproval(snapshot, chainId, registryAddress);

    const prepared = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(8273641)`;
      if (!await this.lockOwned(transaction, intent, leaseOwner)) return null;
      const pendingNonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
      const lastAllocated = await transaction.anchorIntent.findFirst({
        where: { transactionChainId: chainId, relayerAddress: account.address, relayerNonce: { not: null } },
        orderBy: { relayerNonce: "desc" },
        select: { relayerNonce: true }
      });
      const nextPersistedNonce = (lastAllocated?.relayerNonce ?? -1n) + 1n;
      const nonce = Math.max(pendingNonce, Number(nextPersistedNonce));
      if (!Number.isSafeInteger(nonce)) throw new Error("relayer_nonce_out_of_range");
      const args = approval.args;
      const gas = await client.estimateContractGas({ account, address: registryAddress, abi: agreementRegistryAbi, functionName: "registerAgreement", args });
      const gasPrice = await client.getGasPrice();
      const signedTransaction = await account.signTransaction({
        chain,
        chainId,
        to: registryAddress,
        data: approval.calldata,
        nonce,
        gas: gas * 120n / 100n,
        gasPrice
      });
      const hash = keccak256(signedTransaction);
      if (!await this.lockOwned(transaction, intent, leaseOwner)) return null;
      const updated = await transaction.anchorIntent.updateMany({
        where: { id: intent.id, leaseOwner, transactionHash: null, signedTransaction: null },
        data: {
          status: AnchorTransactionStatus.SUBMISSION_UNCERTAIN,
          relayerNonce: BigInt(nonce),
          transactionChainId: chainId,
          relayerAddress: account.address,
          signedTransaction,
          transactionHash: hash,
          submittedAt: new Date(),
          lastError: null
        }
      });
      if (updated.count !== 1) throw new ConflictException("The anchor intent lease expired before the transaction hash was stored.");
      await transaction.agreement.update({
        where: { id: snapshot.agreementId },
        data: { blockchainStatus: AnchorTransactionStatus.SUBMISSION_UNCERTAIN }
      });
      return { transactionHash: hash, signedTransaction, relayerNonce: BigInt(nonce), transactionChainId: chainId, relayerAddress: account.address };
    }, { maxWait: 10_000, timeout: 60_000 });
    if (!prepared) return;
    if (!prepared.transactionHash || !prepared.signedTransaction) throw new ConflictException("The prepared transaction is incomplete.");
    const preparedIntent = { ...intent, ...prepared };
    const admitted = await this.prisma.$transaction(async (tx) => Boolean(await this.lockOwned(tx, preparedIntent, leaseOwner)));
    if (!admitted) return;
    const broadcastHash = await client.sendRawTransaction({ serializedTransaction: prepared.signedTransaction as `0x${string}` });
    if (broadcastHash.toLowerCase() !== prepared.transactionHash.toLowerCase()) {
      return this.transition(preparedIntent, leaseOwner, AnchorTransactionStatus.RECONCILIATION_REQUIRED, "rpc_transaction_hash_mismatch");
    }
    await this.transition(preparedIntent, leaseOwner, AnchorTransactionStatus.SUBMITTED, null);
  }

  private async lockOwned(transaction: Prisma.TransactionClient, intent: WorkerIntent, leaseOwner: string): Promise<Date | null> {
    await transaction.$queryRaw`SELECT "id" FROM "Agreement" WHERE "id" = ${intent.snapshot.agreementId}::uuid FOR UPDATE`;
    await transaction.$queryRaw`SELECT "id" FROM "SigningSnapshot" WHERE "id" = ${intent.snapshotId}::uuid FOR UPDATE`;
    await transaction.$queryRaw`SELECT "id" FROM "AnchorIntent" WHERE "id" = ${intent.id}::uuid FOR UPDATE`;
    const current = await transaction.anchorIntent.findFirst({ where: {
      id: intent.id, leaseOwner, status: { in: recoverableStatuses }, snapshotId: intent.snapshotId,
      transactionHash: intent.transactionHash, signedTransaction: intent.signedTransaction, replacementHash: intent.replacementHash,
      relayerNonce: intent.relayerNonce, relayerAddress: intent.relayerAddress, transactionChainId: intent.transactionChainId,
      snapshot: { id: intent.snapshot.id, agreementId: intent.snapshot.agreementId, version: intent.snapshot.version,
        snapshotHash: intent.snapshot.snapshotHash, canonicalPayload: intent.snapshot.canonicalPayload,
        agreementKey: intent.snapshot.agreementKey, nonce: intent.snapshot.nonce, validUntil: intent.snapshot.validUntil,
        buyerSigner: intent.snapshot.buyerSigner, supplierSigner: intent.snapshot.supplierSigner,
        buyerOrganizationId: intent.snapshot.buyerOrganizationId, supplierOrganizationId: intent.snapshot.supplierOrganizationId,
        invalidatedAt: null, signatureStatus: "COMPLETE",
        agreement: { id: intent.snapshot.agreementId, version: intent.snapshot.version, status: AgreementStatus.ANCHOR_PENDING }
      }
    }, select: { id: true } });
    if (!current) return null;
    const [owned] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS now FROM "AnchorIntent"
      WHERE "id" = ${intent.id}::uuid AND "leaseOwner" = ${leaseOwner} AND "leaseUntil" > clock_timestamp()
    `;
    return owned?.now ?? null;
  }

  private async transition(intent: WorkerIntent, leaseOwner: string, status: AnchorTransactionStatus, reason: string | null, extra: Pick<Prisma.AnchorIntentUpdateManyMutationInput, "replacementHash"> = {}): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const now = await this.lockOwned(transaction, intent, leaseOwner);
      if (!now) return;
      const updated = await transaction.anchorIntent.updateMany({
        where: { id: intent.id, leaseOwner },
        data: { ...extra, status, lastError: reason, leaseOwner: null, leaseUntil: null, ...(status === AnchorTransactionStatus.CONFIRMED ? { confirmedAt: now } : {}) }
      });
      if (updated.count !== 1) throw new ConflictException("The anchor intent changed before finalization.");
      const agreement = await transaction.agreement.updateMany({
        where: { id: intent.snapshot.agreementId, version: intent.snapshot.version, status: AgreementStatus.ANCHOR_PENDING },
        data: { blockchainStatus: status, ...(status === AnchorTransactionStatus.CONFIRMED ? { status: AgreementStatus.ANCHOR_CONFIRMED } : status === AnchorTransactionStatus.FAILED ? { status: AgreementStatus.ANCHOR_FAILED } : {}) }
      });
      if (agreement.count !== 1) throw new ConflictException("The agreement version changed before finalization.");
    });
  }

  private async releaseAfterFailure(intentId: string, leaseOwner: string, error: unknown): Promise<void> {
    const reason = this.errorClass(error);
    const current = await this.prisma.anchorIntent.findUnique({ where: { id: intentId }, include: { snapshot: { include: { signatures: true } } } });
    if (!current) return;
    const retryable = reason === "rpc_unavailable" || reason === "timeout" || reason === "wrong_chain_id";
    const status = current.signedTransaction
      ? reason === "rpc_rejected" ? AnchorTransactionStatus.FAILED : current.status
      : retryable ? AnchorTransactionStatus.QUEUED : AnchorTransactionStatus.FAILED;
    await this.transition(current, leaseOwner, status, reason);
  }

  private async requireParticipant(context: OrganizationAuthContext, agreement: { id: string; version: number; ownerOrganizationId: string }) {
    const participant = await this.prisma.agreementParticipant.findUnique({
      where: { agreementId_agreementVersion_organizationId: { agreementId: agreement.id, agreementVersion: agreement.version, organizationId: context.organization.id } },
      select: { role: true }
    });
    if (participant || agreement.ownerOrganizationId === context.organization.id) return;
    throw new NotFoundException("Agreement not found.");
  }

  private errorClass(error: unknown): string {
    if (error instanceof BaseError && error.walk((cause) => cause instanceof ContractFunctionRevertedError) instanceof ContractFunctionRevertedError) return "transaction_reverted";
    const name = error instanceof Error ? error.name : "";
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (/invalid sender|insufficient funds|intrinsic gas too low|invalid transaction|invalid signature/.test(message)) return "rpc_rejected";
    if (/timeout|timed out/.test(name.toLowerCase() + message)) return "timeout";
    if (/http|rpc|network|socket|fetch/.test(name.toLowerCase() + message)) return "rpc_unavailable";
    if (/unexpected chain id|wrong chain id/.test(message)) return "wrong_chain_id";
    if (message.includes("transaction_reverted")) return "transaction_reverted";
    if (message.includes("registry_readback_mismatch")) return "registry_readback_mismatch";
    return "anchor_processing_failed";
  }

  private errorTypeChain(error: unknown): string {
    const types: string[] = [];
    const seen = new Set<unknown>();
    let current: unknown = error;
    while (current && types.length < 4 && !seen.has(current)) {
      seen.add(current);
      if (!(current instanceof Error)) {
        types.push(typeof current);
        break;
      }
      types.push(/^[A-Za-z][A-Za-z0-9_.]{0,63}$/.test(current.name) ? current.name : "Error");
      current = current.cause;
    }
    return types.join("->") || "unknown";
  }

  private errorCode(error: unknown): string {
    if (!error || typeof error !== "object") return "";
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,31}$/.test(code) ? `; errorCode=${code}` : "";
  }

  private databaseErrorCode(error: unknown): string {
    if (!error || typeof error !== "object") return "";
    const meta = (error as { meta?: unknown }).meta;
    if (!meta || typeof meta !== "object") return "";
    const code = (meta as { code?: unknown }).code;
    return typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? `; databaseCode=${code}` : "";
  }
}

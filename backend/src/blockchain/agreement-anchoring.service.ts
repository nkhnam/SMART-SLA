import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { defineChain, encodeFunctionData, getAddress, keccak256, parseTransaction, recoverTransactionAddress, stringToHex, type Address, type Hash, type TransactionSerialized } from "viem";
import { recoverTypedDataAddress } from "viem";
import { AgreementSignatureParty, AgreementStatus, AnchorTransactionStatus, MembershipRole, Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import type { OrganizationAuthContext } from "../agreements/agreement.types.js";
import { agreementApprovalTypedData, canonicalizeAgreementSnapshot, type AgreementSnapshotInput } from "./agreement-hash.service.js";
import { agreementRegistryAbi } from "./agreement-registry.abi.js";
import { BlockchainNetworkService } from "./blockchain-network.service.js";
import { resolveAnchorRecovery } from "./anchor-recovery.js";

const leaseMs = 60_000;
const pollMs = 15_000;
const replacementSearchDepth = 128n;

function parseSnapshot(payload: string): AgreementSnapshotInput {
  try {
    const value: unknown = JSON.parse(payload);
    if (!value || typeof value !== "object") throw new Error();
    return value as AgreementSnapshotInput;
  } catch {
    throw new ServiceUnavailableException("The frozen signing snapshot is unreadable.");
  }
}

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
          this.logger.warn(`Agreement anchor processing failed (${this.errorClass(error)}).`);
          await this.releaseAfterFailure(claimed.id, claimed.leaseOwner, error);
          break;
        }
      }
    } catch (error) {
      this.logger.error(`Agreement anchor polling failed (${this.errorClass(error)}).`);
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
      await transaction.agreement.update({ where: { id: agreementId }, data: { status: AgreementStatus.ANCHOR_PENDING, blockchainStatus: retryStatus } });
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
      select: { id: true, version: true, ownerOrganizationId: true }
    });
    if (!agreement) throw new NotFoundException("Agreement not found.");
    await this.requireParticipant(context, agreement);
    const snapshot = await this.prisma.signingSnapshot.findUnique({
      where: { agreementId_version: { agreementId, version: agreement.version } },
      include: { anchorIntent: { select: { id: true, transactionHash: true } } }
    });
    if (!snapshot || snapshot.invalidatedAt) return { agreementId, version: agreement.version, verified: false, reason: "no_active_snapshot" };
    const canonical = canonicalizeAgreementSnapshot(parseSnapshot(snapshot.canonicalPayload));
    if (canonical.hash !== snapshot.snapshotHash || canonical.key !== snapshot.agreementKey) {
      if (snapshot.anchorIntent) await this.setReconciliationRequired(snapshot.anchorIntent.id, agreementId, "snapshot_integrity_mismatch");
      throw new ServiceUnavailableException("The stored signing snapshot failed integrity verification.");
    }
    const { client, chainId, registryAddress } = await this.blockchain.getSigningContext();
    await this.assertRegistryDomain(client, chainId, registryAddress);
    const record = await client.readContract({ address: registryAddress, abi: agreementRegistryAbi, functionName: "getAgreement", args: [snapshot.agreementKey as `0x${string}`] });
    if (record.registeredAt === 0n) return { agreementId, version: agreement.version, verified: false, reason: "not_registered" };
    const verified = this.registryRecordMatches(record, snapshot, canonical.snapshot.buyerOrganizationId, canonical.snapshot.supplierOrganizationId);
    if (!verified) {
      if (snapshot.anchorIntent) await this.setReconciliationRequired(snapshot.anchorIntent.id, agreementId, "registry_record_mismatch");
      return { agreementId, version: agreement.version, verified: false, reason: "registry_record_mismatch" };
    }
    await this.prisma.$transaction(async (transaction) => {
      if (snapshot.anchorIntent) await transaction.anchorIntent.update({
        where: { id: snapshot.anchorIntent.id },
        data: { status: AnchorTransactionStatus.CONFIRMED, confirmedAt: new Date(), lastError: null, leaseOwner: null, leaseUntil: null }
      });
      await transaction.agreement.update({
        where: { id: agreementId },
        data: { status: AgreementStatus.ANCHOR_CONFIRMED, blockchainStatus: AnchorTransactionStatus.CONFIRMED }
      });
    });
    return { agreementId, version: agreement.version, verified: true, transactionHash: snapshot.anchorIntent?.transactionHash ?? null };
  }

  private async claimNextIntent(processedIntentIds: string[]) {
    const leaseOwner = randomUUID();
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "AnchorIntent"
        WHERE "status" IN ('QUEUED'::"AnchorTransactionStatus", 'SUBMISSION_UNCERTAIN'::"AnchorTransactionStatus", 'SUBMITTED'::"AnchorTransactionStatus", 'REPLACED'::"AnchorTransactionStatus")
          AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW())
          ${processedIntentIds.length ? Prisma.sql`AND "id" NOT IN (${Prisma.join(processedIntentIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.empty}
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      const intent = rows[0];
      if (!intent) return null;
      await transaction.anchorIntent.update({
        where: { id: intent.id },
        data: { leaseOwner, leaseUntil: new Date(Date.now() + leaseMs), attemptCount: { increment: 1 } }
      });
      return { id: intent.id, leaseOwner };
    });
  }

  private async processIntent(intentId: string, leaseOwner: string): Promise<void> {
    const intent = await this.prisma.anchorIntent.findFirst({
      where: { id: intentId, leaseOwner },
      include: {
        snapshot: {
          include: { signatures: { select: { party: true, signerAddress: true, signature: true } } }
        }
      }
    });
    if (!intent) return;
    const { client, chainId, registryAddress, rpcUrl } = await this.blockchain.getSigningContext();
    await this.assertRegistryDomain(client, chainId, registryAddress);
    const snapshot = intent.snapshot;
    const canonical = canonicalizeAgreementSnapshot(parseSnapshot(snapshot.canonicalPayload));
    if (canonical.hash !== snapshot.snapshotHash || canonical.key !== snapshot.agreementKey) {
      await this.setReconciliationRequired(intent.id, snapshot.agreementId, "snapshot_integrity_mismatch");
      return;
    }
    const storedRecord = await client.readContract({
      address: registryAddress,
      abi: agreementRegistryAbi,
      functionName: "getAgreement",
      args: [snapshot.agreementKey as `0x${string}`]
    });
    if (storedRecord.registeredAt !== 0n) {
      const exact = this.registryRecordMatches(storedRecord, snapshot, canonical.snapshot.buyerOrganizationId, canonical.snapshot.supplierOrganizationId);
      if (!exact) {
        await this.setReconciliationRequired(intent.id, snapshot.agreementId, "registry_record_mismatch");
        return;
      }
      await this.markConfirmed(intent.id, snapshot.agreementId, leaseOwner, intent.replacementHash ?? intent.transactionHash ?? undefined);
      return;
    }

    if (intent.transactionHash && intent.signedTransaction && intent.relayerNonce !== null) {
      let persistedTransaction;
      let persistedFrom: Address;
      try {
        persistedTransaction = parseTransaction(intent.signedTransaction as TransactionSerialized);
        persistedFrom = await recoverTransactionAddress({ serializedTransaction: intent.signedTransaction as TransactionSerialized });
      } catch {
        await this.setReconciliationRequired(intent.id, snapshot.agreementId, "persisted_transaction_decode_failed");
        return;
      }
      if (
        keccak256(intent.signedTransaction as `0x${string}`).toLowerCase() !== intent.transactionHash.toLowerCase()
        || intent.transactionChainId !== chainId
        || !intent.relayerAddress
        || getAddress(intent.relayerAddress) !== getAddress(persistedFrom)
        || persistedTransaction.chainId !== chainId
        || persistedTransaction.nonce !== Number(intent.relayerNonce)
        || !persistedTransaction.to
        || getAddress(persistedTransaction.to) !== getAddress(registryAddress)
      ) {
        await this.setReconciliationRequired(intent.id, snapshot.agreementId, "persisted_transaction_integrity_mismatch");
        return;
      }
      const transactionHash = (intent.replacementHash ?? intent.transactionHash) as Hash;
      let receipt;
      try {
        receipt = await client.getTransactionReceipt({ hash: transactionHash });
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "TransactionReceiptNotFoundError") throw error;
      }
      if (receipt?.status === "reverted") {
        await this.markFailed(intent.id, snapshot.agreementId, leaseOwner, "transaction_reverted");
        return;
      }
      if (receipt?.status === "success") {
        await this.assertRegistryRecord(client, registryAddress, snapshot);
        await this.markConfirmed(intent.id, snapshot.agreementId, leaseOwner, receipt.transactionHash);
        return;
      }
      const pendingTransaction = await client.getTransaction({ hash: transactionHash }).catch((error: unknown) => {
        if (error instanceof Error && error.name === "TransactionNotFoundError") return null;
        throw error;
      });
      if (pendingTransaction) {
        if (
          getAddress(pendingTransaction.from) !== getAddress(intent.relayerAddress)
          || pendingTransaction.nonce !== Number(intent.relayerNonce)
          || !pendingTransaction.to
          || getAddress(pendingTransaction.to) !== getAddress(registryAddress)
          || pendingTransaction.input.toLowerCase() !== (persistedTransaction.data ?? "0x").toLowerCase()
        ) {
          await this.setReconciliationRequired(intent.id, snapshot.agreementId, "replacement_transaction_integrity_mismatch");
          return;
        }
        await this.prisma.anchorIntent.updateMany({
          where: { id: intent.id, leaseOwner },
          data: { status: intent.replacementHash ? AnchorTransactionStatus.REPLACED : AnchorTransactionStatus.SUBMITTED, leaseOwner: null, leaseUntil: null }
        });
        return;
      }
      const pendingNonce = await client.getTransactionCount({ address: intent.relayerAddress as Address, blockTag: "pending" });
      const latestNonce = await client.getTransactionCount({ address: intent.relayerAddress as Address, blockTag: "latest" });
      if (pendingNonce > Number(intent.relayerNonce) && latestNonce <= Number(intent.relayerNonce)) {
        await this.prisma.$transaction(async (transaction) => {
          await transaction.anchorIntent.updateMany({
            where: { id: intent.id, leaseOwner },
            data: { status: AnchorTransactionStatus.SUBMISSION_UNCERTAIN, lastError: "replacement_pending_unknown", leaseOwner: null, leaseUntil: null }
          });
          await transaction.agreement.update({ where: { id: snapshot.agreementId }, data: { blockchainStatus: AnchorTransactionStatus.SUBMISSION_UNCERTAIN } });
        });
        return;
      }
      if (latestNonce > Number(intent.relayerNonce)) {
        const latestBlock = await client.getBlockNumber();
        const firstBlock = latestBlock > replacementSearchDepth ? latestBlock - replacementSearchDepth : 0n;
        for (let blockNumber = latestBlock; blockNumber >= firstBlock; blockNumber -= 1n) {
          const block = await client.getBlock({ blockNumber, includeTransactions: true });
          const replacement = block.transactions.find((transaction) => typeof transaction !== "string"
            && getAddress(transaction.from) === getAddress(intent.relayerAddress!)
            && transaction.nonce === Number(intent.relayerNonce));
          if (!replacement || typeof replacement === "string") continue;
          if (replacement.hash === intent.transactionHash) {
            await this.prisma.anchorIntent.updateMany({
              where: { id: intent.id, leaseOwner },
              data: { status: AnchorTransactionStatus.SUBMITTED, lastError: null, leaseOwner: null, leaseUntil: null }
            });
            return;
          }
          await this.prisma.$transaction(async (transaction) => {
            await transaction.anchorIntent.updateMany({
              where: { id: intent.id, leaseOwner },
              data: { status: AnchorTransactionStatus.REPLACED, replacementHash: replacement.hash, lastError: "replacement_discovered", leaseOwner: null, leaseUntil: null }
            });
            await transaction.agreement.update({ where: { id: snapshot.agreementId }, data: { blockchainStatus: AnchorTransactionStatus.REPLACED } });
          });
          return;
        }
      }
      const recovery = resolveAnchorRecovery({
        registry: "missing",
        receipt: "missing",
        transaction: "missing",
        pendingNonce: BigInt(pendingNonce),
        relayerNonce: intent.relayerNonce
      });
      if (recovery === "MANUAL_RECONCILIATION") {
        await this.setReconciliationRequired(intent.id, snapshot.agreementId, "relayer_nonce_consumed_without_matching_registry_record");
        return;
      }
      if (recovery !== "REBROADCAST_SAME_TRANSACTION") return;
      const broadcastHash = await client.sendRawTransaction({ serializedTransaction: intent.signedTransaction as `0x${string}` });
      if (broadcastHash.toLowerCase() !== intent.transactionHash.toLowerCase()) {
        await this.setReconciliationRequired(intent.id, snapshot.agreementId, "rpc_transaction_hash_mismatch");
        return;
      }
      await this.prisma.anchorIntent.updateMany({
        where: { id: intent.id, leaseOwner },
        data: { status: AnchorTransactionStatus.SUBMITTED, submittedAt: new Date(), lastError: null, leaseOwner: null, leaseUntil: null }
      });
      return;
    }

    if (snapshot.signatures.length !== 2) {
      await this.setReconciliationRequired(intent.id, snapshot.agreementId, "signature_count_mismatch");
      return;
    }
    const account = this.blockchain.getRelayerAccount();
    const chain = defineChain({
      id: chainId,
      name: `SLA-DEX chain ${chainId}`,
      nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } }
    });
    const typedData = agreementApprovalTypedData(
      canonical,
      chainId,
      registryAddress,
      snapshot.nonce,
      Math.floor(snapshot.validUntil.getTime() / 1000)
    );
    const buyerSignature = snapshot.signatures.find((signature) => signature.party === AgreementSignatureParty.BUYER);
    const supplierSignature = snapshot.signatures.find((signature) => signature.party === AgreementSignatureParty.SUPPLIER);
    if (!buyerSignature || !supplierSignature) {
      await this.setReconciliationRequired(intent.id, snapshot.agreementId, "signature_party_mismatch");
      return;
    }
    const [buyerRecovered, supplierRecovered] = await Promise.all([
      recoverTypedDataAddress({ ...typedData, signature: buyerSignature.signature as `0x${string}` }),
      recoverTypedDataAddress({ ...typedData, signature: supplierSignature.signature as `0x${string}` })
    ]);
    if (buyerRecovered.toLowerCase() !== snapshot.buyerSigner.toLowerCase() || supplierRecovered.toLowerCase() !== snapshot.supplierSigner.toLowerCase()) {
      await this.setReconciliationRequired(intent.id, snapshot.agreementId, "signature_integrity_mismatch");
      return;
    }

    const prepared = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(8273641)`;
      const current = await transaction.anchorIntent.findFirst({ where: { id: intent.id, leaseOwner }, select: { transactionHash: true, signedTransaction: true } });
      if (!current) throw new ConflictException("The anchor intent lease expired before transaction preparation.");
      if (current.transactionHash && current.signedTransaction) return current;
      const pendingNonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
      const lastAllocated = await transaction.anchorIntent.findFirst({
        where: { transactionChainId: chainId, relayerAddress: account.address, relayerNonce: { not: null } },
        orderBy: { relayerNonce: "desc" },
        select: { relayerNonce: true }
      });
      const nextPersistedNonce = (lastAllocated?.relayerNonce ?? -1n) + 1n;
      const nonce = Math.max(pendingNonce, Number(nextPersistedNonce));
      if (!Number.isSafeInteger(nonce)) throw new Error("relayer_nonce_out_of_range");
      const args = [typedData.message, buyerSignature.signature as `0x${string}`, supplierSignature.signature as `0x${string}`] as const;
      const gas = await client.estimateContractGas({ account, address: registryAddress, abi: agreementRegistryAbi, functionName: "registerAgreement", args });
      const gasPrice = await client.getGasPrice();
      const signedTransaction = await account.signTransaction({
        chain,
        chainId,
        to: registryAddress,
        data: encodeFunctionData({ abi: agreementRegistryAbi, functionName: "registerAgreement", args }),
        nonce,
        gas: gas * 120n / 100n,
        gasPrice
      });
      const hash = keccak256(signedTransaction);
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
      return { transactionHash: hash, signedTransaction };
    }, { maxWait: 10_000, timeout: 60_000 });
    if (!prepared.transactionHash || !prepared.signedTransaction) throw new ConflictException("The prepared transaction is incomplete.");
    const broadcastHash = await client.sendRawTransaction({ serializedTransaction: prepared.signedTransaction as `0x${string}` });
    if (broadcastHash.toLowerCase() !== prepared.transactionHash.toLowerCase()) {
      await this.setReconciliationRequired(intent.id, snapshot.agreementId, "rpc_transaction_hash_mismatch");
      return;
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.anchorIntent.updateMany({
        where: { id: intent.id, leaseOwner, transactionHash: prepared.transactionHash },
        data: { status: AnchorTransactionStatus.SUBMITTED, lastError: null }
      });
      await transaction.agreement.update({ where: { id: snapshot.agreementId }, data: { blockchainStatus: AnchorTransactionStatus.SUBMITTED } });
    });
  }

  private async assertRegistryRecord(client: Awaited<ReturnType<BlockchainNetworkService["getSigningContext"]>>["client"], registryAddress: Address, snapshot: { agreementKey: string; snapshotHash: string; canonicalPayload: string; version: number; validUntil: Date }) {
    const record = await client.readContract({ address: registryAddress, abi: agreementRegistryAbi, functionName: "getAgreement", args: [snapshot.agreementKey as `0x${string}`] });
    const canonical = canonicalizeAgreementSnapshot(parseSnapshot(snapshot.canonicalPayload));
    if (!this.registryRecordMatches(record, snapshot, canonical.snapshot.buyerOrganizationId, canonical.snapshot.supplierOrganizationId)) {
      throw new Error("registry_readback_mismatch");
    }
  }

  private async assertRegistryDomain(client: Awaited<ReturnType<BlockchainNetworkService["getSigningContext"]>>["client"], chainId: number, registryAddress: Address): Promise<void> {
    const bytecode = await client.getCode({ address: registryAddress });
    if (!bytecode || bytecode === "0x") throw new Error("registry_contract_missing");
    const [, domainName, domainVersion, domainChainId, verifyingContract] = await client.readContract({
      address: registryAddress,
      abi: agreementRegistryAbi,
      functionName: "eip712Domain"
    });
    if (
      domainName !== "SLA-DEX Agreement Registry"
      || domainVersion !== "1"
      || domainChainId !== BigInt(chainId)
      || getAddress(verifyingContract) !== getAddress(registryAddress)
    ) throw new Error("registry_domain_mismatch");
  }

  private registryRecordMatches(
    record: { agreementHash: string; version: bigint; buyerOrganization: string; supplierOrganization: string; validUntil: bigint; registeredAt: bigint },
    snapshot: { snapshotHash: string; version: number; validUntil: Date },
    buyerOrganizationId: string,
    supplierOrganizationId: string
  ): boolean {
    return record.registeredAt !== 0n
      && record.agreementHash.toLowerCase() === snapshot.snapshotHash.toLowerCase()
      && Number(record.version) === snapshot.version
      && record.buyerOrganization.toLowerCase() === keccak256(stringToHex(buyerOrganizationId)).toLowerCase()
      && record.supplierOrganization.toLowerCase() === keccak256(stringToHex(supplierOrganizationId)).toLowerCase()
      && record.validUntil === BigInt(Math.floor(snapshot.validUntil.getTime() / 1000));
  }

  private async markConfirmed(intentId: string, agreementId: string, leaseOwner: string, transactionHash?: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.anchorIntent.updateMany({
        where: { id: intentId, leaseOwner },
        data: {
          status: AnchorTransactionStatus.CONFIRMED,
          ...(transactionHash ? { transactionHash } : {}),
          confirmedAt: new Date(),
          leaseOwner: null,
          leaseUntil: null,
          lastError: null
        }
      });
      if (updated.count !== 1) return;
      await transaction.agreement.update({
        where: { id: agreementId },
        data: { status: AgreementStatus.ANCHOR_CONFIRMED, blockchainStatus: AnchorTransactionStatus.CONFIRMED }
      });
    });
  }

  private async markFailed(intentId: string, agreementId: string, leaseOwner: string, reason: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.anchorIntent.updateMany({
        where: { id: intentId, leaseOwner },
        data: { status: AnchorTransactionStatus.FAILED, lastError: reason, leaseOwner: null, leaseUntil: null }
      });
      if (updated.count !== 1) return;
      await transaction.agreement.update({
        where: { id: agreementId },
        data: { status: AgreementStatus.ANCHOR_FAILED, blockchainStatus: AnchorTransactionStatus.FAILED }
      });
    });
  }

  private async setReconciliationRequired(intentId: string, agreementId: string, reason: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.anchorIntent.update({
        where: { id: intentId },
        data: { status: AnchorTransactionStatus.RECONCILIATION_REQUIRED, lastError: reason, leaseOwner: null, leaseUntil: null }
      });
      await transaction.agreement.update({ where: { id: agreementId }, data: { blockchainStatus: AnchorTransactionStatus.RECONCILIATION_REQUIRED } });
    });
  }

  private async releaseAfterFailure(intentId: string, leaseOwner: string, error: unknown): Promise<void> {
    const reason = this.errorClass(error);
    if (reason === "registry_readback_mismatch") {
      const intent = await this.prisma.anchorIntent.findUnique({ where: { id: intentId }, select: { snapshot: { select: { agreementId: true } } } });
      if (intent) await this.setReconciliationRequired(intentId, intent.snapshot.agreementId, reason);
      return;
    }
    const retryable = reason === "rpc_unavailable" || reason === "timeout" || reason === "wrong_chain_id";
    const current = await this.prisma.anchorIntent.findUnique({
      where: { id: intentId },
      select: { transactionHash: true, replacementHash: true, signedTransaction: true, snapshot: { select: { agreementId: true } } }
    });
    if (!current) return;
    const status = current.signedTransaction
      ? reason === "rpc_rejected" ? AnchorTransactionStatus.FAILED : AnchorTransactionStatus.SUBMISSION_UNCERTAIN
      : retryable ? AnchorTransactionStatus.QUEUED : AnchorTransactionStatus.FAILED;
    await this.prisma.anchorIntent.updateMany({
      where: { id: intentId, leaseOwner },
      data: {
        status,
        lastError: reason,
        leaseOwner: null,
        leaseUntil: null
      }
    });
    await this.prisma.agreement.updateMany({
      where: { id: current.snapshot.agreementId },
      data: { blockchainStatus: status, ...(status === AnchorTransactionStatus.FAILED ? { status: AgreementStatus.ANCHOR_FAILED } : {}) }
    });
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
}

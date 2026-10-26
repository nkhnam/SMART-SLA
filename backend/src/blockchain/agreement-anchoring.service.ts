import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createWalletClient, defineChain, http, keccak256, stringToHex, type Address, type Hash } from "viem";
import { recoverTypedDataAddress } from "viem";
import { AgreementSignatureParty, AgreementStatus, AnchorTransactionStatus, MembershipRole } from "../generated/prisma/client.js";
import { PrismaService } from "../database/prisma.service.js";
import type { OrganizationAuthContext } from "../agreements/agreement.types.js";
import { agreementApprovalTypedData, canonicalizeAgreementSnapshot, type AgreementSnapshotInput } from "./agreement-hash.service.js";
import { agreementRegistryAbi } from "./agreement-registry.abi.js";
import { BlockchainNetworkService } from "./blockchain-network.service.js";

const leaseMs = 60_000;
const pollMs = 15_000;

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
      for (let count = 0; count < 10; count += 1) {
        const claimed = await this.claimNextIntent();
        if (!claimed) break;
        try {
          await this.processIntent(claimed.id, claimed.leaseOwner);
        } catch (error) {
          this.logger.warn(`Agreement anchor processing failed (${this.errorClass(error)}).`);
          await this.releaseAfterFailure(claimed.id, claimed.leaseOwner, error);
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
      const changed = await transaction.anchorIntent.updateMany({
        where: { snapshotId: snapshot.id, status: AnchorTransactionStatus.FAILED },
        data: {
          status: AnchorTransactionStatus.QUEUED,
          transactionHash: null,
          replacementHash: null,
          submittedAt: null,
          lastError: null,
          leaseOwner: null,
          leaseUntil: null
        }
      });
      if (changed.count !== 1) throw new ConflictException("Only a failed anchor attempt can be retried.");
      await transaction.agreement.update({ where: { id: agreementId }, data: { status: AgreementStatus.ANCHOR_PENDING, blockchainStatus: AnchorTransactionStatus.QUEUED } });
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
      return { agreementId, version: agreement.version, blockchainStatus: AnchorTransactionStatus.QUEUED };
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
    const { client, registryAddress } = await this.blockchain.getSigningContext();
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

  private async claimNextIntent() {
    const leaseOwner = randomUUID();
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "AnchorIntent"
        WHERE "status" IN ('QUEUED'::"AnchorTransactionStatus", 'SUBMITTED'::"AnchorTransactionStatus", 'REPLACED'::"AnchorTransactionStatus")
          AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW())
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
      await this.markConfirmed(intent.id, snapshot.agreementId, leaseOwner, intent.transactionHash ?? intent.replacementHash ?? undefined);
      return;
    }

    if (intent.transactionHash) {
      const receipt = await this.waitForTrackedTransaction(intent.id, leaseOwner, client, intent.transactionHash as Hash);
      if (receipt.status !== "success") throw new Error("transaction_reverted");
      await this.assertRegistryRecord(client, registryAddress, snapshot);
      await this.markConfirmed(intent.id, snapshot.agreementId, leaseOwner, receipt.transactionHash);
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
    const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
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

    const transactionHash = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(8273641)`;
      const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
      const hash = await wallet.writeContract({
        address: registryAddress,
        abi: agreementRegistryAbi,
        functionName: "registerAgreement",
        args: [typedData.message, buyerSignature.signature as `0x${string}`, supplierSignature.signature as `0x${string}`],
        nonce
      });
      const updated = await transaction.anchorIntent.updateMany({
        where: { id: intent.id, leaseOwner },
        data: { status: AnchorTransactionStatus.SUBMITTED, transactionHash: hash, submittedAt: new Date(), lastError: null }
      });
      if (updated.count !== 1) throw new ConflictException("The anchor intent lease expired before the transaction hash was stored.");
      await transaction.agreement.update({
        where: { id: snapshot.agreementId },
        data: { blockchainStatus: AnchorTransactionStatus.SUBMITTED }
      });
      return hash;
    }, { maxWait: 10_000, timeout: 60_000 });
    const receipt = await this.waitForTrackedTransaction(intent.id, leaseOwner, client, transactionHash);
    if (receipt.status !== "success") throw new Error("transaction_reverted");
    await this.assertRegistryRecord(client, registryAddress, snapshot);
    await this.markConfirmed(intent.id, snapshot.agreementId, leaseOwner, receipt.transactionHash);
  }

  private async waitForTrackedTransaction(
    intentId: string,
    leaseOwner: string,
    client: Awaited<ReturnType<BlockchainNetworkService["getSigningContext"]>>["client"],
    hash: Hash
  ) {
    let replacementHash: Hash | undefined;
    const receipt = await client.waitForTransactionReceipt({
      hash,
      confirmations: this.blockchain.getConfirmationCount(),
      onReplaced: ({ transaction }) => { replacementHash = transaction.hash; }
    });
    if (replacementHash) await this.prisma.anchorIntent.updateMany({
      where: { id: intentId, leaseOwner },
      data: { status: AnchorTransactionStatus.REPLACED, replacementHash }
    });
    return receipt;
  }

  private async assertRegistryRecord(client: Awaited<ReturnType<BlockchainNetworkService["getSigningContext"]>>["client"], registryAddress: Address, snapshot: { agreementKey: string; snapshotHash: string; canonicalPayload: string; version: number; validUntil: Date }) {
    const record = await client.readContract({ address: registryAddress, abi: agreementRegistryAbi, functionName: "getAgreement", args: [snapshot.agreementKey as `0x${string}`] });
    const canonical = canonicalizeAgreementSnapshot(parseSnapshot(snapshot.canonicalPayload));
    if (!this.registryRecordMatches(record, snapshot, canonical.snapshot.buyerOrganizationId, canonical.snapshot.supplierOrganizationId)) {
      throw new Error("registry_readback_mismatch");
    }
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
    const retryable = reason === "rpc_unavailable" || reason === "timeout";
    const current = await this.prisma.anchorIntent.findUnique({
      where: { id: intentId },
      select: { transactionHash: true, replacementHash: true, snapshot: { select: { agreementId: true } } }
    });
    if (!current) return;
    const status = retryable
      ? current.transactionHash
        ? current.replacementHash ? AnchorTransactionStatus.REPLACED : AnchorTransactionStatus.SUBMITTED
        : AnchorTransactionStatus.QUEUED
      : AnchorTransactionStatus.FAILED;
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
      data: { blockchainStatus: status, ...(!retryable ? { status: AgreementStatus.ANCHOR_FAILED } : {}) }
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
    if (/timeout|timed out/.test(name.toLowerCase() + message)) return "timeout";
    if (/http|rpc|network|socket|fetch/.test(name.toLowerCase() + message)) return "rpc_unavailable";
    if (message.includes("transaction_reverted")) return "transaction_reverted";
    if (message.includes("registry_readback_mismatch")) return "registry_readback_mismatch";
    return "anchor_processing_failed";
  }
}

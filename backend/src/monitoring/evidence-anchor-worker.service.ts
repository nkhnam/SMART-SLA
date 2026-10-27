import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { createPublicClient, defineChain, encodeAbiParameters, encodeFunctionData, getAddress, http, keccak256, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EvidenceAnchorStatus } from "../generated/prisma/client.js";
import type { AppEnvironment } from "../config/env.schema.js";
import { PrismaService } from "../database/prisma.service.js";
import { evidenceRegistryAbi } from "./evidence-registry.abi.js";

const pollMs = 15_000;
const leaseMs = 60_000;

@Injectable()
export class EvidenceAnchorWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EvidenceAnchorWorkerService.name);
  private readonly workerId = randomUUID();
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService<AppEnvironment, true>) {}

  onModuleInit(): void {
    if (!this.configured()) return;
    this.timer = setInterval(() => void this.processPending(), pollMs);
    this.timer.unref();
    void this.processPending();
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  async processPending(): Promise<void> {
    if (this.running || !this.configured()) return;
    this.running = true;
    try {
      const intent = await this.claim();
      if (intent) await this.process(intent.id);
    } catch (error) {
      this.logger.error(`Evidence anchor worker failed (${error instanceof Error ? error.name : "unknown"}).`);
    } finally {
      this.running = false;
    }
  }

  private configured(): boolean {
    return Boolean(this.config.get("EVIDENCE_RPC_URL", { infer: true }) && this.config.get("EVIDENCE_CHAIN_ID", { infer: true })
      && this.config.get("EVIDENCE_REGISTRY_ADDRESS", { infer: true }) && this.config.get("EVIDENCE_RELAYER_PRIVATE_KEY", { infer: true }));
  }

  private async claim() {
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "EvidenceAnchorIntent"
        WHERE "status" IN ('PENDING'::"EvidenceAnchorStatus", 'SUBMITTED'::"EvidenceAnchorStatus")
          AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW())
        ORDER BY "createdAt" ASC, "id" ASC FOR UPDATE SKIP LOCKED LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      await transaction.evidenceAnchorIntent.update({ where: { id: row.id }, data: { leaseOwner: this.workerId, leaseUntil: new Date(Date.now() + leaseMs), attemptCount: { increment: 1 } } });
      return row;
    });
  }

  private async process(intentId: string): Promise<void> {
    const intent = await this.prisma.evidenceAnchorIntent.findFirst({ where: { id: intentId, leaseOwner: this.workerId }, include: { batch: true } });
    if (!intent) return;
    const rpcUrl = this.config.getOrThrow("EVIDENCE_RPC_URL", { infer: true });
    const chainId = this.config.getOrThrow("EVIDENCE_CHAIN_ID", { infer: true });
    const registry = getAddress(this.config.getOrThrow("EVIDENCE_REGISTRY_ADDRESS", { infer: true })) as Address;
    const account = privateKeyToAccount(this.config.getOrThrow("EVIDENCE_RELAYER_PRIVATE_KEY", { infer: true }) as Hex);
    const chain = defineChain({ id: chainId, name: `SLA-DEX evidence chain ${chainId}`, nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
    const client = createPublicClient({ chain, transport: http(rpcUrl) });
    const registryCode = await client.getCode({ address: registry });
    if (await client.getChainId() !== chainId || registryCode === "0x") return this.reconcile(intent.id, "evidence_registry_unavailable_or_wrong_chain");
    const configuredPublisher = await client.readContract({ address: registry, abi: evidenceRegistryAbi, functionName: "publisher" });
    if (configuredPublisher.toLowerCase() !== account.address.toLowerCase()) return this.reconcile(intent.id, "evidence_publisher_configuration_mismatch");
    const agreementVersionKey = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint64" }], [keccak256(stringToHex(intent.batch.agreementId)), BigInt(intent.batch.agreementVersion)]));
    const schemaVersionHash = keccak256(stringToHex(intent.batch.schemaVersion));
    const args = [intent.anchorKey as Hex, agreementVersionKey, intent.batch.merkleRoot as Hex, intent.batch.batchDigest as Hex, schemaVersionHash, BigInt(intent.batch.agreementVersion), BigInt(Math.floor(intent.batch.windowStart.getTime() / 1000)), BigInt(Math.floor(intent.batch.windowEnd.getTime() / 1000))] as const;
    const existing = await client.readContract({ address: registry, abi: evidenceRegistryAbi, functionName: "getCommitment", args: [intent.anchorKey as Hex] });
    if (existing.committedAt > 0n) {
      if (existing.agreementVersionKey !== args[1] || existing.merkleRoot !== args[2] || existing.batchDigest !== args[3] || existing.schemaVersionHash !== args[4] || existing.agreementVersion !== args[5] || existing.reporter.toLowerCase() !== (intent.relayerAddress ?? account.address).toLowerCase()) return this.reconcile(intent.id, "evidence_commitment_mismatch");
      return this.confirm(intent.id, intent.leaseOwner!, intent.transactionHash ?? null);
    }
    if (intent.transactionHash) {
      const receipt = await client.getTransactionReceipt({ hash: intent.transactionHash as Hex }).catch(() => null);
      if (receipt?.status === "reverted") {
        await this.prisma.evidenceAnchorIntent.updateMany({ where: { id: intent.id, leaseOwner: intent.leaseOwner }, data: { status: EvidenceAnchorStatus.FAILED, lastError: "evidence_transaction_reverted", leaseOwner: null, leaseUntil: null } });
        return;
      }
      if (receipt?.status === "success") return this.reconcile(intent.id, "evidence_receipt_without_matching_commitment");
    }
    const transactionData = encodeFunctionData({ abi: evidenceRegistryAbi, functionName: "commitEvidence", args });
    if (!intent.signedTransaction || !intent.transactionHash) {
      const prepared = await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(8273642)`;
        const pendingNonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
        const lastAllocated = await transaction.evidenceAnchorIntent.findFirst({ where: { transactionChainId: chainId, relayerAddress: account.address, relayerNonce: { not: null } }, orderBy: { relayerNonce: "desc" }, select: { relayerNonce: true } });
        const nonce = Math.max(pendingNonce, Number((lastAllocated?.relayerNonce ?? -1n) + 1n));
        if (!Number.isSafeInteger(nonce)) throw new Error("evidence_nonce_out_of_range");
        const gas = await client.estimateGas({ account, to: registry, data: transactionData });
        const gasPrice = await client.getGasPrice();
        const signedTransaction = await account.signTransaction({ chain, chainId, to: registry, data: transactionData, nonce, gas: gas * 120n / 100n, gasPrice });
        const transactionHash = keccak256(signedTransaction);
        await transaction.evidenceAnchorIntent.update({ where: { id: intent.id }, data: { status: EvidenceAnchorStatus.PENDING, transactionChainId: chainId, relayerAddress: account.address, relayerNonce: BigInt(nonce), signedTransaction, transactionHash } });
        return { signedTransaction, transactionHash };
      }, { maxWait: 10_000, timeout: 60_000 });
      intent.signedTransaction = prepared.signedTransaction;
      intent.transactionHash = prepared.transactionHash;
    }
    const broadcast = await client.sendRawTransaction({ serializedTransaction: intent.signedTransaction as Hex });
    if (broadcast.toLowerCase() !== intent.transactionHash.toLowerCase()) return this.reconcile(intent.id, "evidence_transaction_hash_mismatch");
    await this.prisma.evidenceAnchorIntent.updateMany({ where: { id: intent.id, leaseOwner: intent.leaseOwner }, data: { status: EvidenceAnchorStatus.SUBMITTED, submittedAt: new Date(), leaseOwner: null, leaseUntil: null, lastError: null } });
  }

  private async confirm(intentId: string, leaseOwner: string, transactionHash: string | null): Promise<void> {
    if (transactionHash) {
      const client = await this.getReceiptClient();
      const receipt = await client.getTransactionReceipt({ hash: transactionHash as Hex }).catch(() => null);
      const confirmations = this.config.getOrThrow("EVIDENCE_CONFIRMATIONS", { infer: true });
      if (receipt?.status === "reverted") {
        await this.prisma.evidenceAnchorIntent.updateMany({ where: { id: intentId, leaseOwner }, data: { status: EvidenceAnchorStatus.FAILED, lastError: "evidence_transaction_reverted", leaseOwner: null, leaseUntil: null } });
        return;
      }
      if (!receipt || (await client.getBlockNumber()) - receipt.blockNumber + 1n < BigInt(confirmations)) return;
    }
    await this.prisma.evidenceAnchorIntent.updateMany({ where: { id: intentId, leaseOwner }, data: { status: EvidenceAnchorStatus.CONFIRMED, confirmedAt: new Date(), leaseOwner: null, leaseUntil: null, lastError: null } });
  }

  private async getReceiptClient() {
    const rpcUrl = this.config.getOrThrow("EVIDENCE_RPC_URL", { infer: true });
    const chainId = this.config.getOrThrow("EVIDENCE_CHAIN_ID", { infer: true });
    const chain = defineChain({ id: chainId, name: `SLA-DEX evidence chain ${chainId}`, nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
    return createPublicClient({ chain, transport: http(rpcUrl) });
  }

  private async reconcile(intentId: string, reason: string): Promise<void> {
    await this.prisma.evidenceAnchorIntent.updateMany({ where: { id: intentId, leaseOwner: this.workerId }, data: { status: EvidenceAnchorStatus.RECONCILIATION_REQUIRED, lastError: reason, leaseOwner: null, leaseUntil: null } });
  }
}

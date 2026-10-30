import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { BaseError, ContractFunctionRevertedError, ExecutionRevertedError, createPublicClient, defineChain, encodeAbiParameters, encodeFunctionData, getAddress, http, keccak256, parseTransaction, recoverTransactionAddress, stringToHex, type Address, type Hex, type TransactionSerialized } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EvidenceAnchorStatus, Prisma } from "../generated/prisma/client.js";
import type { AppEnvironment } from "../config/env.schema.js";
import { PrismaService } from "../database/prisma.service.js";
import { evidenceRegistryAbi } from "./evidence-registry.abi.js";

const pollMs = 15_000;
const leaseMs = 60_000;
class NoncanonicalEvidenceReceipt extends Error {}
class UnconfirmedEvidenceReceipt extends Error {}

export const EVIDENCE_RPC_CLIENT = Symbol("EVIDENCE_RPC_CLIENT");
export function createEvidenceRpcClient(rpcUrl: string, chainId: number) {
  const chain = defineChain({ id: chainId, name: `SLA-DEX evidence chain ${chainId}`, nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  return createPublicClient({ chain, transport: http(rpcUrl), cacheTime: 0 });
}

@Injectable()
export class EvidenceAnchorWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EvidenceAnchorWorkerService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppEnvironment, true>,
    @Inject(EVIDENCE_RPC_CLIENT) private readonly rpcClient: typeof createEvidenceRpcClient = createEvidenceRpcClient
  ) {}

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
      const processed: string[] = [];
      for (let index = 0; index < 10; index++) {
        const intent = await this.claim(processed);
        if (!intent) break;
        processed.push(intent.id);
        try { await this.process(intent.id, intent.leaseOwner); }
        catch (error) {
          const reason = this.errorReason(error);
          this.logger.warn(`Evidence intent ${intent.id} processing failed (${reason}).`);
          await this.prisma.$transaction(async (transaction) => {
            if (!await this.lockOwned(transaction, intent.id, intent.leaseOwner)) return;
            const current = await transaction.evidenceAnchorIntent.findUniqueOrThrow({ where: { id: intent.id } });
            await transaction.evidenceAnchorIntent.update({ where: { id: intent.id }, data: {
              ...(!current.signedTransaction && reason === "evidence_transaction_reverted" ? { status: EvidenceAnchorStatus.FAILED } : {}),
              lastError: reason, leaseOwner: null, leaseUntil: null
            } });
          });
        }
      }
    } catch (error) {
      this.logger.error(`Evidence anchor worker poll failed (${this.errorReason(error)}).`);
    } finally {
      this.running = false;
    }
  }

  private configured(): boolean {
    return Boolean(this.config.get("EVIDENCE_RPC_URL", { infer: true }) && this.config.get("EVIDENCE_CHAIN_ID", { infer: true })
      && this.config.get("EVIDENCE_REGISTRY_ADDRESS", { infer: true }) && this.config.get("EVIDENCE_RELAYER_PRIVATE_KEY", { infer: true }));
  }

  private async claim(excluded: string[]) {
    const leaseOwner = randomUUID();
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "EvidenceAnchorIntent"
        WHERE "status" IN ('PENDING'::"EvidenceAnchorStatus", 'SUBMITTED'::"EvidenceAnchorStatus")
          AND ("leaseUntil" IS NULL OR "leaseUntil" <= clock_timestamp())
          ${excluded.length ? Prisma.sql`AND "id" NOT IN (${Prisma.join(excluded.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.empty}
        ORDER BY "createdAt" ASC, "id" ASC FOR UPDATE SKIP LOCKED LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      const [{ now }] = await transaction.$queryRaw<[{ now: Date }]>`SELECT clock_timestamp() AS now`;
      await transaction.evidenceAnchorIntent.update({ where: { id: row.id }, data: { leaseOwner, leaseUntil: new Date(now.getTime() + leaseMs), attemptCount: { increment: 1 } } });
      return { ...row, leaseOwner };
    });
  }

  private async process(intentId: string, leaseOwner: string): Promise<void> {
    const intent = await this.prisma.evidenceAnchorIntent.findFirst({ where: { id: intentId, leaseOwner }, include: { batch: true } });
    if (!intent) return;
    const rpcUrl = this.config.getOrThrow("EVIDENCE_RPC_URL", { infer: true });
    const chainId = this.config.getOrThrow("EVIDENCE_CHAIN_ID", { infer: true });
    const registry = getAddress(this.config.getOrThrow("EVIDENCE_REGISTRY_ADDRESS", { infer: true })) as Address;
    const account = privateKeyToAccount(this.config.getOrThrow("EVIDENCE_RELAYER_PRIVATE_KEY", { infer: true }) as Hex);
    const client = this.rpcClient(rpcUrl, chainId);
    const registryCode = await client.getCode({ address: registry });
    if (await client.getChainId() !== chainId || !registryCode || registryCode === "0x") return this.transition(intent.id, leaseOwner, EvidenceAnchorStatus.RECONCILIATION_REQUIRED, "evidence_registry_unavailable_or_wrong_chain");
    const agreementVersionKey = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint64" }], [keccak256(stringToHex(intent.batch.agreementId)), BigInt(intent.batch.agreementVersion)]));
    const schemaVersionHash = keccak256(stringToHex(intent.batch.schemaVersion));
    const args = [intent.anchorKey as Hex, agreementVersionKey, intent.batch.merkleRoot as Hex, intent.batch.batchDigest as Hex, schemaVersionHash, BigInt(intent.batch.agreementVersion), BigInt(Math.floor(intent.batch.windowStart.getTime() / 1000)), BigInt(Math.floor(intent.batch.windowEnd.getTime() / 1000))] as const;
    const transactionData = encodeFunctionData({ abi: evidenceRegistryAbi, functionName: "commitEvidence", args });
    const persistedFields = [intent.signedTransaction, intent.transactionHash, intent.transactionChainId, intent.relayerAddress, intent.relayerNonce];
    if (persistedFields.some((value) => value !== null)) {
      let valid = persistedFields.every((value) => value !== null);
      if (valid) {
        try {
          const decoded = parseTransaction(intent.signedTransaction as Hex);
          const signer = await recoverTransactionAddress({ serializedTransaction: intent.signedTransaction as TransactionSerialized });
          valid = keccak256(intent.signedTransaction as Hex).toLowerCase() === intent.transactionHash!.toLowerCase()
            && decoded.chainId === chainId && intent.transactionChainId === chainId
            && Number.isSafeInteger(Number(intent.relayerNonce)) && decoded.nonce === Number(intent.relayerNonce) && getAddress(signer) === getAddress(intent.relayerAddress!)
            && !!decoded.to && getAddress(decoded.to) === registry
            && decoded.data?.toLowerCase() === transactionData.toLowerCase() && (decoded.value ?? 0n) === 0n;
        } catch { valid = false; }
      }
      if (!valid) return this.transition(intent.id, leaseOwner, EvidenceAnchorStatus.RECONCILIATION_REQUIRED, "evidence_persisted_transaction_mismatch");
    }
    const head = await client.getBlock({ blockTag: "latest" });
    const existing = await client.readContract({ address: registry, abi: evidenceRegistryAbi, functionName: "getCommitment", args: [intent.anchorKey as Hex], blockNumber: head.number });
    if (existing.committedAt > 0n) {
      await this.assertCanonicalSnapshot(client, head);
      if (existing.agreementVersionKey.toLowerCase() !== args[1].toLowerCase() || existing.merkleRoot.toLowerCase() !== args[2].toLowerCase() || existing.batchDigest.toLowerCase() !== args[3].toLowerCase() || existing.schemaVersionHash.toLowerCase() !== args[4].toLowerCase() || existing.agreementVersion !== args[5] || existing.windowStart !== args[6] || existing.windowEnd !== args[7] || existing.reporter.toLowerCase() !== (intent.relayerAddress ?? account.address).toLowerCase()) return this.transition(intent.id, leaseOwner, EvidenceAnchorStatus.RECONCILIATION_REQUIRED, "evidence_commitment_mismatch");
      if (!intent.transactionHash) return this.transition(intent.id, leaseOwner, EvidenceAnchorStatus.RECONCILIATION_REQUIRED, "evidence_commitment_without_transaction");
      const receipt = await this.receipt(client, intent.transactionHash as Hex, head);
      if (receipt?.status === "reverted") return this.transition(intent.id, leaseOwner, EvidenceAnchorStatus.FAILED, "evidence_transaction_reverted");
      if (!receipt) return this.transition(intent.id, leaseOwner, EvidenceAnchorStatus.SUBMITTED, "evidence_receipt_pending");
      return this.transition(intent.id, leaseOwner, EvidenceAnchorStatus.CONFIRMED, null);
    }
    if (intent.transactionHash) {
      const receipt = await this.receipt(client, intent.transactionHash as Hex, head);
      if (receipt?.status === "reverted") {
        return this.transition(intent.id, leaseOwner, EvidenceAnchorStatus.FAILED, "evidence_transaction_reverted");
      }
      if (receipt?.status === "success") return this.transition(intent.id, leaseOwner, EvidenceAnchorStatus.RECONCILIATION_REQUIRED, "evidence_receipt_without_matching_commitment");
      const pending = await client.getTransaction({ hash: intent.transactionHash as Hex }).catch((error: unknown) => {
        if (error instanceof Error && error.name === "TransactionNotFoundError") return null;
        throw error;
      });
      if (pending) return this.transition(intent.id, leaseOwner, EvidenceAnchorStatus.SUBMITTED, "evidence_receipt_pending");
      const latestNonce = await client.getTransactionCount({ address: intent.relayerAddress as Address, blockNumber: head.number });
      if (latestNonce > Number(intent.relayerNonce)) {
        await this.assertCanonicalSnapshot(client, head);
        return this.transition(intent.id, leaseOwner, EvidenceAnchorStatus.RECONCILIATION_REQUIRED, "evidence_nonce_consumed_without_commitment");
      }
      const pendingNonce = await client.getTransactionCount({ address: intent.relayerAddress as Address, blockTag: "pending" });
      if (pendingNonce > Number(intent.relayerNonce)) return this.transition(intent.id, leaseOwner, EvidenceAnchorStatus.SUBMITTED, "evidence_nonce_pending_unknown");
    }
    const configuredPublisher = await client.readContract({ address: registry, abi: evidenceRegistryAbi, functionName: "publisher" });
    if (configuredPublisher.toLowerCase() !== account.address.toLowerCase() || (intent.relayerAddress && intent.relayerAddress.toLowerCase() !== account.address.toLowerCase())) return this.transition(intent.id, leaseOwner, EvidenceAnchorStatus.RECONCILIATION_REQUIRED, "evidence_publisher_configuration_mismatch");
    if (!intent.signedTransaction || !intent.transactionHash) {
      const pendingNonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
      const gas = await client.estimateGas({ account, to: registry, data: transactionData });
      const gasPrice = await client.getGasPrice();
      const prepared = await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(8273642)`;
        if (!await this.lockOwned(transaction, intent.id, leaseOwner)) return null;
        const lastAllocated = await transaction.evidenceAnchorIntent.findFirst({ where: { transactionChainId: chainId, relayerAddress: account.address, relayerNonce: { not: null } }, orderBy: { relayerNonce: "desc" }, select: { relayerNonce: true } });
        const nonce = Math.max(pendingNonce, Number((lastAllocated?.relayerNonce ?? -1n) + 1n));
        if (!Number.isSafeInteger(nonce)) throw new Error("evidence_nonce_out_of_range");
        const signedTransaction = await account.signTransaction({ chainId, to: registry, data: transactionData, nonce, gas: gas * 120n / 100n, gasPrice });
        const transactionHash = keccak256(signedTransaction);
        await transaction.evidenceAnchorIntent.update({ where: { id: intent.id }, data: { status: EvidenceAnchorStatus.PENDING, transactionChainId: chainId, relayerAddress: account.address, relayerNonce: BigInt(nonce), signedTransaction, transactionHash } });
        return { signedTransaction, transactionHash };
      });
      if (!prepared) return;
      intent.signedTransaction = prepared.signedTransaction;
      intent.transactionHash = prepared.transactionHash;
    }
    const admitted = await this.prisma.$transaction(async (transaction) => Boolean(await this.lockOwned(transaction, intent.id, leaseOwner)));
    if (!admitted) return;
    const broadcast = await client.sendRawTransaction({ serializedTransaction: intent.signedTransaction as Hex });
    if (broadcast.toLowerCase() !== intent.transactionHash!.toLowerCase()) return this.transition(intent.id, leaseOwner, EvidenceAnchorStatus.RECONCILIATION_REQUIRED, "evidence_transaction_hash_mismatch");
    await this.transition(intent.id, leaseOwner, EvidenceAnchorStatus.SUBMITTED, null, true);
  }

  private async assertCanonicalSnapshot(client: ReturnType<typeof createEvidenceRpcClient>, head: { number: bigint; hash: Hex }): Promise<void> {
    if ((await client.getBlock({ blockNumber: head.number })).hash !== head.hash) throw new NoncanonicalEvidenceReceipt();
  }

  private async receipt(client: ReturnType<typeof createEvidenceRpcClient>, hash: Hex, head: { number: bigint; hash: Hex }) {
    const receipt = await client.getTransactionReceipt({ hash }).catch((error: unknown) => {
      if (error instanceof Error && error.name === "TransactionReceiptNotFoundError") return null;
      throw error;
    });
    if (receipt) {
      const canonical = await client.getBlock({ blockNumber: receipt.blockNumber });
      if (canonical.hash !== receipt.blockHash) throw new NoncanonicalEvidenceReceipt();
      await this.assertCanonicalSnapshot(client, head);
      const confirmations = this.config.getOrThrow("EVIDENCE_CONFIRMATIONS", { infer: true });
      if (head.number - receipt.blockNumber + 1n < BigInt(confirmations)) throw new UnconfirmedEvidenceReceipt();
    }
    return receipt;
  }

  private async lockOwned(transaction: Prisma.TransactionClient, intentId: string, leaseOwner: string): Promise<Date | null> {
    await transaction.$queryRaw`SELECT "id" FROM "EvidenceAnchorIntent" WHERE "id" = ${intentId}::uuid FOR UPDATE`;
    const [owned] = await transaction.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AS now FROM "EvidenceAnchorIntent"
      WHERE "id" = ${intentId}::uuid AND "leaseOwner" = ${leaseOwner} AND "leaseUntil" > clock_timestamp()
        AND "status" IN ('PENDING'::"EvidenceAnchorStatus", 'SUBMITTED'::"EvidenceAnchorStatus")
    `;
    if (!owned) this.logger.warn(`Evidence intent ${intentId} write rejected (lease_lost_or_intent_terminal).`);
    return owned?.now ?? null;
  }

  private async transition(intentId: string, leaseOwner: string, status: EvidenceAnchorStatus, reason: string | null, submitted = false): Promise<void> {
    const written = await this.prisma.$transaction(async (transaction) => {
      const now = await this.lockOwned(transaction, intentId, leaseOwner);
      if (!now) return false;
      await transaction.evidenceAnchorIntent.update({ where: { id: intentId }, data: {
        status, lastError: reason, leaseOwner: null, leaseUntil: null,
        ...(status === EvidenceAnchorStatus.CONFIRMED ? { confirmedAt: now } : {}),
        ...(submitted ? { submittedAt: now } : {})
      } });
      return true;
    });
    if (written && reason) this.logger.warn(`Evidence intent ${intentId} state ${status} (${reason}).`);
  }

  private errorReason(error: unknown): string {
    if (error instanceof NoncanonicalEvidenceReceipt) return "evidence_receipt_noncanonical";
    if (error instanceof UnconfirmedEvidenceReceipt) return "evidence_confirmations_pending";
    if (error instanceof Prisma.PrismaClientKnownRequestError) return `evidence_database_${error.code}`;
    if (error instanceof BaseError) {
      const cause = error.walk((item) => item instanceof ContractFunctionRevertedError || item instanceof ExecutionRevertedError);
      if (cause instanceof ContractFunctionRevertedError || cause instanceof ExecutionRevertedError) return "evidence_transaction_reverted";
    }
    const message = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : "";
    if (/timeout|timed out/.test(message)) return "evidence_rpc_timeout";
    if (/invalid sender|insufficient funds|intrinsic gas too low|invalid transaction|invalid signature/.test(message)) return "evidence_rpc_rejected";
    return "evidence_rpc_unavailable";
  }
}

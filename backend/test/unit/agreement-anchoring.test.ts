import assert from "node:assert/strict";
import { test } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, parseTransaction } from "viem";
import { AgreementAnchoringService } from "../../src/blockchain/agreement-anchoring.service.js";
import { agreementApprovalTypedData, canonicalizeAgreementSnapshot } from "../../src/blockchain/agreement-hash.service.js";

const chainId = 31_337;
const registryAddress = "0x00000000000000000000000000000000000000a1" as const;
const buyer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const supplier = privateKeyToAccount(`0x${"22".repeat(32)}`);
const relayer = privateKeyToAccount(`0x${"33".repeat(32)}`);

test("an RPC rejection before broadcast preserves the signed transaction and fails without retrying", async () => {
  const agreementId = "3ebf6e45-1c81-4e68-9510-13c6cfb6c9a7";
  const validUntil = 1_893_456_000;
  const input = {
    agreementId,
    reference: "SLA-2026-001",
    version: 1,
    buyerOrganizationId: "0b847a83-7b9f-4c99-8803-7e7607a1e228",
    supplierOrganizationId: "b0f2af02-399f-4bd2-b8cb-1c818de6d4fc",
    name: "Cloud SLA",
    serviceDescription: "Managed platform",
    uptimeTargetBasisPoints: 9995,
    responseTimeTargetMs: 180,
    measurementWindowHours: 24,
    exclusions: ["maintenance"],
    notes: null,
    buyerSigner: buyer.address,
    supplierSigner: supplier.address,
    validUntil
  };
  const canonical = canonicalizeAgreementSnapshot(input);
  const typedData = agreementApprovalTypedData(canonical, chainId, registryAddress, 0n, validUntil);
  const [buyerSignature, supplierSignature] = await Promise.all([
    buyer.signTypedData(typedData),
    supplier.signTypedData(typedData)
  ]);
  const intent = {
    id: "intent-1",
    snapshotId: "snapshot-1",
    idempotencyKey: "snapshot-1",
    status: "QUEUED",
    attemptCount: 0,
    relayerNonce: null as bigint | null,
    transactionChainId: null as number | null,
    relayerAddress: null as string | null,
    signedTransaction: null as string | null,
    transactionHash: null as string | null,
    replacementHash: null as string | null,
    lastError: null as string | null,
    leaseOwner: null as string | null,
    leaseUntil: null as Date | null,
    snapshot: {
      id: "snapshot-1",
      agreementId,
      version: 1,
      snapshotHash: canonical.hash,
      agreementKey: canonical.key,
      canonicalPayload: JSON.stringify(input),
      nonce: 0n,
      validUntil: new Date(validUntil * 1000),
      buyerSigner: buyer.address,
      supplierSigner: supplier.address,
      signatures: [
        { party: "BUYER", signerAddress: buyer.address, signature: buyerSignature },
        { party: "SUPPLIER", signerAddress: supplier.address, signature: supplierSignature }
      ]
    }
  };
  let sendAttempts = 0;
  const warningMessages: string[] = [];
  const registered = false;
  const prisma = {
    $transaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
      $queryRaw: async (strings: TemplateStringsArray) => strings.join("").includes("FOR UPDATE SKIP LOCKED") ? [{ id: intent.id }] : [],
      anchorIntent: {
        findFirst: async ({ where }: { where?: Record<string, unknown> }) => {
          if (where?.transactionChainId) return null;
          return { transactionHash: intent.transactionHash, signedTransaction: intent.signedTransaction };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(intent, data),
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          if (where.leaseOwner && where.leaseOwner !== intent.leaseOwner) return { count: 0 };
          Object.assign(intent, data);
          return { count: 1 };
        },
        findUnique: async () => ({ signedTransaction: intent.signedTransaction, snapshot: { agreementId } })
      },
      agreement: { update: async () => undefined, updateMany: async () => ({ count: 1 }) }
    }),
    anchorIntent: {
      findFirst: async () => intent,
      findUnique: async () => ({ signedTransaction: intent.signedTransaction, snapshot: { agreementId } }),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (where.leaseOwner && where.leaseOwner !== intent.leaseOwner) return { count: 0 };
        Object.assign(intent, data);
        return { count: 1 };
      }
    },
    agreement: { updateMany: async () => ({ count: 1 }) }
  };
  const client = {
    getCode: async () => "0x1234",
    readContract: async ({ functionName }: { functionName: string }) => functionName === "eip712Domain"
      ? ["0x0f", "SLA-DEX Agreement Registry", "1", BigInt(chainId), registryAddress, `0x${"00".repeat(32)}`, []]
      : { agreementHash: `0x${"00".repeat(32)}`, version: 0n, buyerOrganization: `0x${"00".repeat(32)}`, supplierOrganization: `0x${"00".repeat(32)}`, validUntil: 0n, registeredAt: 0n },
    getTransactionCount: async () => 0,
    estimateContractGas: async () => 100_000n,
    getGasPrice: async () => 1n,
    sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: string }) => {
      sendAttempts += 1;
      assert.equal(intent.status, "SUBMISSION_UNCERTAIN");
      assert.equal(intent.signedTransaction, serializedTransaction);
      assert.equal(registered, false);
      throw Object.assign(new Error("invalid sender", { cause: new TypeError("wallet internals") }), { code: "P2002" });
    }
  };
  const blockchain = {
    isAnchorConfigured: () => true,
    getSigningContext: async () => ({ client, chainId, registryAddress, rpcUrl: "http://127.0.0.1:8545" }),
    getRelayerAccount: () => relayer,
    getConfirmationCount: () => 1
  };
  const service = new AgreementAnchoringService(prisma as never, blockchain as never);
  Object.assign(service, { logger: { warn: (message: string) => warningMessages.push(message), error: () => undefined } });
  await service.processPendingIntents();

  assert.equal(sendAttempts, 1);
  assert.equal(intent.status, "FAILED");
  assert.equal(intent.relayerNonce, 0n);
  assert.match(intent.transactionHash ?? "", /^0x[0-9a-f]{64}$/);
  assert.match(intent.signedTransaction ?? "", /^0x(?:0[12]|f)/);
  assert.equal(intent.transactionHash, keccak256(intent.signedTransaction as `0x${string}`));
  assert.equal(BigInt(parseTransaction(intent.signedTransaction as `0x${string}`).chainId ?? 0), BigInt(chainId));
  assert.equal(intent.lastError, "rpc_rejected");
  assert.equal(registered, false);
  assert.match(warningMessages[0] ?? "", /errorTypes=Error->TypeError/);
  assert.match(warningMessages[0] ?? "", /errorCode=P2002/);
  assert.doesNotMatch(warningMessages[0] ?? "", /invalid sender|wallet internals/);
});

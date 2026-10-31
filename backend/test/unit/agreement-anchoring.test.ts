import assert from "node:assert/strict";
import { test } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { BaseError, ContractFunctionExecutionError, ContractFunctionRevertedError, encodeFunctionData, keccak256, parseTransaction, stringToHex } from "viem";
import { agreementRegistryAbi } from "../../src/blockchain/agreement-registry.abi.js";
import { AgreementAnchoringService } from "../../src/blockchain/agreement-anchoring.service.js";
import { agreementApprovalTypedData, canonicalizeAgreementSnapshot } from "../../src/blockchain/agreement-hash.service.js";

const chainId = 31_337;
const registryAddress = "0x00000000000000000000000000000000000000a1" as const;
const buyer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const supplier = privateKeyToAccount(`0x${"22".repeat(32)}`);
const relayer = privateKeyToAccount(`0x${"33".repeat(32)}`);

async function proofFixture(required = 3, head = 100n) {
  const input = {
    agreementId: "3ebf6e45-1c81-4e68-9510-13c6cfb6c9a7", reference: "SLA-proof", version: 1,
    buyerOrganizationId: "0b847a83-7b9f-4c99-8803-7e7607a1e228", supplierOrganizationId: "b0f2af02-399f-4bd2-b8cb-1c818de6d4fc",
    name: "Cloud SLA", serviceDescription: "Managed platform", uptimeTargetBasisPoints: 9995,
    responseTimeTargetMs: 180, measurementWindowHours: 24, exclusions: [], notes: null,
    buyerSigner: buyer.address, supplierSigner: supplier.address, validUntil: 1_893_456_000
  };
  const canonical = canonicalizeAgreementSnapshot(input);
  const typedData = agreementApprovalTypedData(canonical, chainId, registryAddress, 0n, input.validUntil);
  const buyerSignature = await buyer.signTypedData(typedData);
  const supplierSignature = await supplier.signTypedData(typedData);
  const data = encodeFunctionData({ abi: agreementRegistryAbi, functionName: "registerAgreement", args: [typedData.message, buyerSignature, supplierSignature] });
  const signedTransaction = await relayer.signTransaction({ chainId, to: registryAddress, nonce: 7, data, gas: 300_000n, gasPrice: 1n });
  const transactionHash = keccak256(signedTransaction);
  const blockHash = `0x${"ab".repeat(32)}`;
  const snapshot = {
    id: "snapshot-proof", agreementId: input.agreementId, version: 1, canonicalPayload: canonical.canonicalJson,
    agreementKey: canonical.key, snapshotHash: canonical.hash, nonce: 0n, validUntil: new Date(input.validUntil * 1000),
    buyerSigner: buyer.address, supplierSigner: supplier.address, buyerOrganizationId: input.buyerOrganizationId,
    supplierOrganizationId: input.supplierOrganizationId, invalidatedAt: null, signatureStatus: "COMPLETE",
    signatures: [{ party: "BUYER", signerAddress: buyer.address, signature: buyerSignature }, { party: "SUPPLIER", signerAddress: supplier.address, signature: supplierSignature }],
    anchorIntent: { id: "intent-proof", snapshotId: "snapshot-proof", status: "SUBMITTED", transactionHash, replacementHash: null as string | null,
      signedTransaction: signedTransaction as string | null, transactionChainId: chainId, relayerAddress: relayer.address, relayerNonce: 7n }
  };
  const record = { agreementHash: canonical.hash, version: 1n, buyerOrganization: keccak256(stringToHex(input.buyerOrganizationId)), supplierOrganization: keccak256(stringToHex(input.supplierOrganizationId)), validUntil: BigInt(input.validUntil), registeredAt: 1n };
  const receipt = { transactionHash, blockHash, blockNumber: 100n, status: "success" };
  const transaction = { hash: transactionHash, chainId, from: relayer.address, nonce: 7, to: registryAddress, input: data, value: 0n, blockHash, blockNumber: 100n };
  const agreement = { id: input.agreementId, version: 1, ownerOrganizationId: input.buyerOrganizationId, status: "ANCHOR_PENDING", blockchainStatus: "SUBMITTED" };
  const intent = { ...snapshot.anchorIntent, leaseOwner: null as string | null, leaseUntil: null as Date | null, snapshot };
  let claimed = false;
  let writes = 0;
  const write = async () => { writes++; return { count: 1 }; };
  const prisma = {
    agreement: { findUnique: async () => agreement, update: write, updateMany: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(agreement, data); return write(); } },
    signingSnapshot: { findUnique: async () => snapshot }, agreementParticipant: { findUnique: async () => ({ role: "BUYER" }) },
    anchorIntent: {
      findFirst: async ({ orderBy }: { orderBy?: unknown }) => orderBy ? null : intent, findUnique: async () => intent,
      update: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(intent, data); return write(); },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(intent, data); return write(); }
    },
    $queryRaw: async (strings: TemplateStringsArray) => {
      if (strings.join("").includes("SKIP LOCKED")) { if (claimed) return []; claimed = true; return [{ id: intent.id, now: new Date() }]; }
      return [{ id: intent.id, now: new Date() }];
    },
    $executeRaw: async () => 1,
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => { writes++; return callback(prisma); }
  };
  const client = {
    getChainId: async () => chainId, getCode: async () => "0x1234",
    readContract: async ({ functionName }: { functionName: string }) => functionName === "eip712Domain"
      ? ["0x0f", "SLA-DEX Agreement Registry", "1", BigInt(chainId), registryAddress, `0x${"00".repeat(32)}`, []] : record,
    getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => ({ number: blockNumber ?? head, hash: blockHash }),
    getTransactionReceipt: async () => receipt, getTransaction: async () => transaction,
    getTransactionCount: async () => 7, estimateContractGas: async () => 100_000n, getGasPrice: async () => 1n,
    sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: `0x${string}` }) => keccak256(serializedTransaction)
  };
  const blockchain = { isAnchorConfigured: () => true, getSigningContext: async () => ({ client, chainId, registryAddress, rpcUrl: "http://127.0.0.1:8545" }), getConfirmationCount: () => required, getRelayerAccount: () => relayer };
  const service = new AgreementAnchoringService(prisma as never, blockchain as never);
  const context = { user: { id: "buyer-user" }, organization: { id: input.buyerOrganizationId, role: "OWNER" } };
  return { service, client, snapshot, intent, record, receipt, transaction, agreement, context, prisma, blockchain, writes: () => writes,
    verify: () => service.verifyAgreement(context as never, input.agreementId) };
}

for (const [head, status, expected] of [[100n, "success", "SUBMITTED"], [101n, "success", "SUBMITTED"], [102n, "success", "CONFIRMED"], [100n, "reverted", "SUBMITTED"], [102n, "reverted", "FAILED"]] as const) {
  test(`worker receipt ${status} at head ${head} requires depth 3`, async () => {
    const fixture = await proofFixture(3, head);
    fixture.receipt.status = status;
    if (status === "reverted") fixture.record.registeredAt = 0n;
    await fixture.service.processPendingIntents();
    assert.equal(fixture.intent.status, expected);
  });
}

const proofFaults: Array<[string, (fixture: Awaited<ReturnType<typeof proofFixture>>) => void]> = [
  ["missing receipt", (f) => { f.client.getTransactionReceipt = async () => { throw Object.assign(new Error(), { name: "TransactionReceiptNotFoundError" }); }; }],
  ["receipt RPC timeout", (f) => { f.client.getTransactionReceipt = async () => { throw new Error("RPC timed out"); }; }],
  ["receipt RPC unavailable", (f) => { f.client.getTransactionReceipt = async () => { throw new Error("HTTP service unavailable"); }; }],
  ["noncanonical receipt", (f) => { f.receipt.blockHash = `0x${"cd".repeat(32)}`; }],
  ["head reorganization", (f) => { let reads = 0; f.client.getBlock = async ({ blockNumber } = {}) => ({ number: blockNumber ?? 102n, hash: reads++ < 2 ? f.receipt.blockHash : `0x${"cd".repeat(32)}` }); }],
  ["wrong receipt hash", (f) => { f.receipt.transactionHash = `0x${"cd".repeat(32)}`; }],
  ["wrong destination", (f) => { Object.assign(f.transaction, { to: buyer.address }); }],
  ["wrong calldata", (f) => { f.transaction.input = "0x"; }],
  ["wrong sender", (f) => { f.transaction.from = buyer.address; }],
  ["wrong nonce", (f) => { f.transaction.nonce++; }],
  ["wrong transaction chain", (f) => { f.transaction.chainId++; }],
  ["registry hash mismatch", (f) => { f.record.agreementHash = `0x${"cd".repeat(32)}`; }],
  ["registry version mismatch", (f) => { f.record.version++; }],
  ["wrong EIP-712 domain", (f) => { const read = f.client.readContract; f.client.readContract = async (args) => args.functionName === "eip712Domain" ? ["0x0f", "Wrong Registry", "1", BigInt(chainId), registryAddress, "0x", []] : read(args); }],
  ["wrong configured chain", (f) => { f.client.getChainId = async () => chainId + 1; }],
  ["original signed byte corruption", (f) => { f.snapshot.anchorIntent.signedTransaction = "0x1234"; }],
  ["final head RPC rejection", (f) => { let reads = 0; const get = f.client.getBlock; f.client.getBlock = async (args) => { if (++reads >= 3) throw new Error("RPC invalid transaction response"); return get(args); }; }]
];
for (const [name, change] of proofFaults) {
  test(`verification fails closed without writes for ${name}`, async () => {
    const fixture = await proofFixture(3, 102n);
    change(fixture);
    const result = await fixture.verify();
    assert.equal(result.verified, false);
    assert.equal(fixture.writes(), 0);
  });
}

test("a final head RPC rejection cannot fail a worker operation without receipt proof", async () => {
  const fixture = await proofFixture(3, 102n);
  let reads = 0;
  const get = fixture.client.getBlock;
  fixture.client.getBlock = async (args) => { if (++reads >= 3) throw new Error("RPC invalid transaction response"); return get(args); };
  await fixture.service.processPendingIntents();
  assert.equal(fixture.intent.status, "SUBMITTED");
  assert.equal((fixture.intent as unknown as { lastError: string }).lastError, "rpc_unavailable");
});

for (const [name, change] of [["valid", () => undefined], ["calldata", (f: Awaited<ReturnType<typeof proofFixture>>) => { f.transaction.input = "0x"; }], ["sender", (f: Awaited<ReturnType<typeof proofFixture>>) => { f.transaction.from = buyer.address; }], ["nonce", (f: Awaited<ReturnType<typeof proofFixture>>) => { f.transaction.nonce++; }]] as const) {
  test(`tracked replacement ${name} is independently validated without overwriting original identity`, async () => {
    const fixture = await proofFixture(3, 102n);
    const originalHash = fixture.snapshot.anchorIntent.transactionHash;
    const originalBytes = fixture.snapshot.anchorIntent.signedTransaction;
    const replacement = `0x${"ef".repeat(32)}` as const;
    fixture.snapshot.anchorIntent.replacementHash = replacement;
    fixture.transaction.hash = replacement;
    fixture.receipt.transactionHash = replacement;
    change(fixture);
    assert.equal((await fixture.verify()).verified, name === "valid");
    assert.equal(fixture.snapshot.anchorIntent.transactionHash, originalHash);
    assert.ok(fixture.snapshot.anchorIntent.signedTransaction === originalBytes, "replacement preserves original signed bytes");
    assert.equal(fixture.writes(), 0);
  });
}

for (const [required, head, verified] of [[1, 100n, true], [3, 100n, false], [3, 101n, false], [3, 102n, true]] as const) {
  test(`verification requires depth ${required} at head ${head} for receipt block 100`, async () => {
    const fixture = await proofFixture(required, head);
    assert.equal((await fixture.verify()).verified, verified);
    assert.equal(fixture.writes(), 0, "verification must never write durable state");
  });
}

test("a matching external registration without owned proof requires reconciliation without writes", async () => {
  const fixture = await proofFixture();
  Object.assign(fixture.snapshot.anchorIntent, { transactionHash: null, signedTransaction: null, relayerNonce: null });
  const result = await fixture.verify();
  assert.equal(result.verified, false);
  assert.equal(result.reason, "external_registration_without_proof");
  assert.equal(fixture.writes(), 0);
});

for (const head of [100n, 102n]) {
  test(`reverted receipt at head ${head} cannot be verified from another registration`, async () => {
    const fixture = await proofFixture(3, head);
    fixture.receipt.status = "reverted";
    assert.equal((await fixture.verify()).verified, false);
    assert.equal(fixture.writes(), 0);
  });
}

test("snapshot mismatch verification never writes reconciliation state", async () => {
  const fixture = await proofFixture();
  fixture.snapshot.snapshotHash = `0x${"00".repeat(32)}`;
  await fixture.verify().catch(() => undefined);
  assert.equal(fixture.writes(), 0);
});

for (const scenario of [
  {
    name: "an unprepared contract revert fails even when its diagnostic message contains an HTTP link",
    error: new ContractFunctionExecutionError(new ContractFunctionRevertedError({ abi: [], data: "0xdeadbeef", functionName: "registerAgreement" }), { abi: [], functionName: "registerAgreement" }),
    status: "FAILED",
    reason: "transaction_reverted"
  },
  {
    name: "an unprepared RPC outage remains queued for retry",
    error: new BaseError("HTTP request failed"),
    status: "QUEUED",
    reason: "rpc_unavailable"
  }
]) {
  test(scenario.name, async () => {
    const fixture = await proofFixture();
    Object.assign(fixture.intent, { status: "QUEUED", signedTransaction: null, transactionHash: null, relayerNonce: null });
    fixture.blockchain.getSigningContext = async () => { throw scenario.error; };
    Object.assign(fixture.service, { logger: { warn: () => undefined, error: () => undefined } });
    await fixture.service.processPendingIntents();
    assert.equal(fixture.intent.status, scenario.status);
    assert.equal((fixture.intent as unknown as { lastError: string }).lastError, scenario.reason);
    assert.equal(fixture.intent.leaseOwner, null);
    assert.equal(fixture.agreement.blockchainStatus, scenario.status);
    assert.equal(fixture.agreement.status, scenario.status === "FAILED" ? "ANCHOR_FAILED" : "ANCHOR_PENDING");
  });
}

test("an RPC rejection before broadcast preserves the signed transaction and fails without retrying", async () => {
  const fixture = await proofFixture();
  Object.assign(fixture.intent, { status: "QUEUED", signedTransaction: null, transactionHash: null, relayerNonce: null, transactionChainId: null, relayerAddress: null });
  fixture.record.registeredAt = 0n;
  let sends = 0;
  let locked = false;
  const warnings: string[] = [];
  fixture.prisma.$executeRaw = async () => { locked = true; return 1; };
  fixture.client.sendRawTransaction = async ({ serializedTransaction }) => {
    sends++;
    assert.equal(fixture.intent.status, "SUBMISSION_UNCERTAIN");
    assert.ok(fixture.intent.signedTransaction === serializedTransaction, "broadcast uses persisted signed bytes");
    throw Object.assign(new Error("invalid sender", { cause: new TypeError("wallet internals") }), { code: "P2002", meta: { code: "42601" } });
  };
  Object.assign(fixture.service, { logger: { warn: (message: string) => warnings.push(message), error: () => undefined } });
  await fixture.service.processPendingIntents();
  assert.equal(sends, 1);
  assert.equal(locked, true);
  assert.equal(fixture.intent.status, "FAILED");
  assert.equal(fixture.intent.relayerNonce, 7n);
  assert.equal(fixture.intent.transactionHash, keccak256(fixture.intent.signedTransaction as `0x${string}`));
  assert.equal(parseTransaction(fixture.intent.signedTransaction as `0x${string}`).chainId, chainId);
  assert.match(warnings[0] ?? "", /errorTypes=Error->TypeError/);
  assert.match(warnings[0] ?? "", /errorCode=P2002/);
  assert.match(warnings[0] ?? "", /databaseCode=42601/);
  assert.doesNotMatch(warnings[0] ?? "", /invalid sender|wallet internals/);
});

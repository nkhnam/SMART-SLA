import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { after, afterEach, beforeEach, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../dist/generated/prisma/client.js";
import { EvidenceAnchorWorkerService } from "../../dist/monitoring/evidence-anchor-worker.service.js";
import { evidenceRegistryAbi } from "../../dist/monitoring/evidence-registry.abi.js";
import { createPublicClient, createWalletClient, defineChain, encodeAbiParameters, encodeFunctionData, http, keccak256, parseTransaction, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/phase2c_[a-f0-9]{32}_test$/);
assert.equal(new URL(process.env.EVIDENCE_RPC_URL!).hostname, "127.0.0.1");
assert.equal(process.env.EVIDENCE_CHAIN_ID, "31337");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const registry = process.env.EVIDENCE_REGISTRY_ADDRESS as Hex;
const account = privateKeyToAccount(process.env.EVIDENCE_RELAYER_PRIVATE_KEY as Hex);
const chain = defineChain({ id: 31337, name: "Isolated publisher tests", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [process.env.EVIDENCE_RPC_URL!] } } });
const client = createPublicClient({ chain, transport: http(process.env.EVIDENCE_RPC_URL!, { retryCount: 0 }), cacheTime: 0 });
const wallet = createWalletClient({ account, chain, transport: http(process.env.EVIDENCE_RPC_URL!) });
const owner = createWalletClient({ account: privateKeyToAccount(process.env.BLOCKCHAIN_RELAYER_PRIVATE_KEY as Hex), chain, transport: http(process.env.EVIDENCE_RPC_URL!) });
const rotatedKey = `0x${"33".repeat(32)}` as Hex;
const rotated = privateKeyToAccount(rotatedKey);
const rotationAbi = [{ type: "function", name: "setPublisher", stateMutability: "nonpayable", inputs: [{ name: "newPublisher", type: "address" }], outputs: [] }] as const;
const fixtures: Array<{ agreementId: string; organizationId: string; userId: string }> = [];
let evmSnapshot: unknown;

async function rpc(method: string, params: unknown[] = []) {
  const response = await fetch(process.env.EVIDENCE_RPC_URL!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const data = await response.json() as { result?: unknown; error?: unknown };
  assert.equal(data.error, undefined);
  return data.result;
}
beforeEach(async () => { await rpc("evm_setAutomine", [true]); evmSnapshot = await rpc("evm_snapshot"); });
afterEach(async () => {
  assert.equal(await rpc("evm_revert", [evmSnapshot]), true);
  await rpc("evm_setAutomine", [true]);
  for (const fixture of fixtures.splice(0)) {
    await prisma.evidenceAnchorIntent.deleteMany({ where: { batch: { agreementId: fixture.agreementId } } });
    await prisma.evidenceBatch.deleteMany({ where: { agreementId: fixture.agreementId } });
    await prisma.agreement.delete({ where: { id: fixture.agreementId } });
    await prisma.organization.delete({ where: { id: fixture.organizationId } });
    await prisma.user.delete({ where: { id: fixture.userId } });
  }
});
after(() => prisma.$disconnect());

async function fixture() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@publisher.example.test`, displayName: "Synthetic publisher fixture", passwordHash: "test-only" } });
  const organization = await prisma.organization.create({ data: { name: "Synthetic publisher fixture", organizationType: "CUSTOMER" } });
  const agreement = await prisma.agreement.create({ data: { reference: randomUUID().slice(0, 20), createdByUserId: user.id, ownerOrganizationId: organization.id, versions: { create: { version: 1, actorUserId: user.id, name: "Synthetic evidence SLA", serviceDescription: "Publisher fault fixture", counterpartyDisplayName: "Fixture", uptimeTargetPercent: 99, responseTimeTargetMs: 200, measurementWindowHours: 1 } } } });
  fixtures.push({ agreementId: agreement.id, organizationId: organization.id, userId: user.id });
  const batch = await prisma.evidenceBatch.create({ data: { agreementId: agreement.id, agreementVersion: 1, organizationId: organization.id, windowStart: new Date("2026-01-01T00:00:00Z"), windowEnd: new Date("2026-01-01T01:00:00Z"), schemaVersion: "sla-dex-evidence/1", algorithmVersion: "sla-dex-kpi/1", merkleRoot: keccak256(stringToHex(`synthetic-root:${agreement.id}`)), batchDigest: keccak256(stringToHex(`synthetic-digest:${agreement.id}`)), observationCount: 1, canonicalManifest: { synthetic: true }, anchorIntent: { create: { anchorKey: keccak256(stringToHex(`synthetic-key:${agreement.id}`)) } } }, include: { anchorIntent: true } });
  return { ...batch, intentId: batch.anchorIntent!.id };
}

function service(overrides: Record<string, unknown> = {}, confirmations = 1, values: Record<string, unknown> = {}) {
  const config = { get: (key: string) => key in values ? values[key] : key === "EVIDENCE_CONFIRMATIONS" ? confirmations : key === "EVIDENCE_CHAIN_ID" ? 31337 : process.env[key], getOrThrow(key: string) { const value = this.get(key); assert.ok(value !== undefined); return value; } };
  const controlled = new Proxy(client, { get(target, property, receiver) { return typeof property === "string" && property in overrides ? overrides[property] : Reflect.get(target, property, receiver); } });
  return new EvidenceAnchorWorkerService(prisma as never, config as never, (() => controlled) as never);
}
function args(batch: Awaited<ReturnType<typeof fixture>>) {
  return [batch.anchorIntent!.anchorKey as Hex, keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint64" }], [keccak256(stringToHex(batch.agreementId)), 1n])), batch.merkleRoot as Hex, batch.batchDigest as Hex, keccak256(stringToHex(batch.schemaVersion)), 1n, 1767225600n, 1767229200n] as const;
}
async function state(id: string) { return prisma.evidenceAnchorIntent.findUniqueOrThrow({ where: { id } }); }
async function commitment(batch: Awaited<ReturnType<typeof fixture>>) { return client.readContract({ address: registry, abi: evidenceRegistryAbi, functionName: "getCommitment", args: [batch.anchorIntent!.anchorKey as Hex] }); }
async function expire(id: string) { await prisma.$executeRaw`UPDATE "EvidenceAnchorIntent" SET "leaseUntil" = clock_timestamp() WHERE "id" = ${id}::uuid`; }
function barrier() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; }
async function prepared(batch: Awaited<ReturnType<typeof fixture>>) {
  await service({ sendRawTransaction: async () => { throw new Error("controlled timeout before broadcast"); } }).processPending();
  const current = await state(batch.intentId);
  assert.ok(current.signedTransaction);
  assert.ok(current.transactionHash);
  return current;
}
async function databaseFault(id: string, condition: string, run: () => Promise<void>) {
  await prisma.$executeRawUnsafe(`CREATE FUNCTION publisher_write_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."id" = '${id}'::uuid AND (${condition}) THEN RAISE EXCEPTION 'controlled publisher serialization failure' USING ERRCODE = '40001'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe('CREATE TRIGGER publisher_write_fault BEFORE UPDATE ON "EvidenceAnchorIntent" FOR EACH ROW EXECUTE FUNCTION publisher_write_fault()');
  try { await run(); }
  finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER publisher_write_fault ON "EvidenceAnchorIntent"');
    await prisma.$executeRawUnsafe('DROP FUNCTION publisher_write_fault()');
  }
}
async function waitForBlocked(pid: number) {
  const deadline = performance.now() + 3_000;
  while (performance.now() < deadline) {
    const [{ blocked }] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))) AS blocked`;
    if (blocked) return;
  }
  assert.fail("Publisher operation must actually queue behind the PostgreSQL lock");
}
function sameTransaction(actual: Awaited<ReturnType<typeof state>>, expected: Awaited<ReturnType<typeof state>>) {
  for (const key of ["signedTransaction", "transactionHash", "relayerNonce", "relayerAddress", "transactionChainId"] as const) assert.equal(actual[key], expected[key], key);
}

for (const field of ["agreementVersionKey", "merkleRoot", "batchDigest", "schemaVersionHash", "agreementVersion", "windowStart", "windowEnd"] as const) {
  test(`commitment with mismatched ${field} requires reconciliation`, async () => {
    const batch = await fixture();
    const input = [...args(batch)];
    const index = ["batchKey", "agreementVersionKey", "merkleRoot", "batchDigest", "schemaVersionHash", "agreementVersion", "windowStart", "windowEnd"].indexOf(field);
    input[index] = index < 5 ? keccak256(stringToHex(`controlled wrong ${field}`)) : (input[index] as bigint) + 1n;
    await wallet.writeContract({ address: registry, abi: evidenceRegistryAbi, functionName: "commitEvidence", args: input as unknown as ReturnType<typeof args> });
    await service().processPending();
    assert.equal((await state(batch.intentId)).status, "RECONCILIATION_REQUIRED");
    assert.equal((await state(batch.intentId)).lastError, "evidence_commitment_mismatch");
  });
}

test("matching commitment without a durable transaction cannot bypass confirmation depth", async () => {
  const batch = await fixture();
  await wallet.writeContract({ address: registry, abi: evidenceRegistryAbi, functionName: "commitEvidence", args: args(batch) });
  await service({}, 3).processPending();
  const current = await state(batch.intentId);
  assert.equal(current.status, "RECONCILIATION_REQUIRED");
  assert.equal(current.lastError, "evidence_commitment_without_transaction");
  assert.equal(current.confirmedAt, null);
});

for (const phase of ["before-broadcast", "after-broadcast"] as const) {
  test(`killed process ${phase} recovers its durable operation after lease expiry`, { timeout: 15_000 }, async (t) => {
    const batch = await fixture();
    const child = spawn(process.execPath, ["--input-type=module", "--eval", `
      import "reflect-metadata";
      import { PrismaPg } from "@prisma/adapter-pg";
      import { PrismaClient } from "./dist/generated/prisma/client.js";
      import { EvidenceAnchorWorkerService, createEvidenceRpcClient } from "./dist/monitoring/evidence-anchor-worker.service.js";
      const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
      const config = { get: key => key === "EVIDENCE_CHAIN_ID" ? 31337 : key === "EVIDENCE_CONFIRMATIONS" ? 1 : process.env[key], getOrThrow(key) { return this.get(key); } };
      const factory = (url, id) => { const client = createEvidenceRpcClient(url, id); return new Proxy(client, { get(target, property, receiver) {
        if (property === "sendRawTransaction") return async args => {
          if (${phase === "after-broadcast"}) await client.sendRawTransaction(args);
          process.send("boundary-entered");
          await new Promise(() => {});
        };
        return Reflect.get(target, property, receiver);
      } }); };
      await new EvidenceAnchorWorkerService(prisma, config, factory).processPending();
    `], { cwd: process.cwd(), env: process.env, windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    let diagnostics = "";
    child.stderr.on("data", (chunk) => { diagnostics += chunk; });
    const closed = once(child, "close");
    const stop = () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };
    t.signal.addEventListener("abort", stop, { once: true });
    t.after(async () => { stop(); await closed; });
    try {
      const message = await Promise.race([once(child, "message"), closed.then(() => { throw new Error(`Publisher crash fixture exited early: ${diagnostics}`); })]);
      assert.equal(message[0], "boundary-entered");
      const saved = await state(batch.intentId);
      assert.equal(saved.status, "PENDING");
      assert.ok(saved.signedTransaction);
      assert.equal(keccak256(saved.signedTransaction as Hex), saved.transactionHash);
      child.kill("SIGKILL");
      await closed;
      await service().processPending();
      assert.equal((await state(batch.intentId)).attemptCount, 1, "restart must respect the still-active lease");
      await expire(batch.intentId);
      await service().processPending();
      if (phase === "before-broadcast") await service().processPending();
      const confirmed = await state(batch.intentId);
      assert.equal(confirmed.status, "CONFIRMED");
      sameTransaction(confirmed, saved);
      assert.equal(await client.getTransactionCount({ address: account.address }), 1);
    } finally { stop(); await closed; t.signal.removeEventListener("abort", stop); }
  });
}

test("concurrent workers claim one intent and overlapping polls do not duplicate work", { timeout: 15_000 }, async () => {
  const batch = await fixture();
  const entered = barrier();
  const release = barrier();
  const firstWorker = service({ getCode: async (input: Parameters<typeof client.getCode>[0]) => { entered.release(); await release.promise; return client.getCode(input); } });
  const first = firstWorker.processPending();
  try {
    await entered.promise;
    await Promise.all([service().processPending(), firstWorker.processPending()]);
    assert.equal((await state(batch.intentId)).attemptCount, 1);
    assert.equal((await state(batch.intentId)).signedTransaction, null);
  } finally { release.release(); await first; }
  await service().processPending();
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
  assert.equal(await client.getTransactionCount({ address: account.address }), 1);
});

test("concurrent different intents reserve distinct nonces and both commitments confirm", async () => {
  const first = await fixture();
  const second = await fixture();
  await rpc("evm_setAutomine", [false]);
  await Promise.all([service().processPending(), service().processPending()]);
  const states = await Promise.all([state(first.intentId), state(second.intentId)]);
  assert.deepEqual(states.map((intent) => Number(intent.relayerNonce)).sort(), [0, 1]);
  assert.equal(new Set(states.map((intent) => intent.transactionHash)).size, 2);
  await rpc("evm_mine");
  await service().processPending();
  assert.equal((await state(first.intentId)).status, "CONFIRMED");
  assert.equal((await state(second.intentId)).status, "CONFIRMED");
  assert.equal((await commitment(first)).merkleRoot, first.merkleRoot);
  assert.equal((await commitment(second)).merkleRoot, second.merkleRoot);
});

test("lease expiry during estimation prevents stale transaction preparation", async () => {
  const batch = await fixture();
  let sends = 0;
  await service({ estimateGas: async (input: Parameters<typeof client.estimateGas>[0]) => { await expire(batch.intentId); return client.estimateGas(input); }, sendRawTransaction: async () => { sends++; throw new Error("stale send"); } }).processPending();
  assert.equal((await state(batch.intentId)).signedTransaction, null);
  assert.equal(sends, 0);
  await service().processPending();
  await service().processPending();
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
});

for (const completion of ["return", "throw"] as const) {
  test(`stale broadcast ${completion} cannot overwrite a new owner's confirmation`, { timeout: 15_000 }, async () => {
    const batch = await fixture();
    const entered = barrier();
    const release = barrier();
    const first = service({ sendRawTransaction: async (input: Parameters<typeof client.sendRawTransaction>[0]) => {
      const hash = await client.sendRawTransaction(input); entered.release(); await release.promise;
      if (completion === "throw") throw new Error("controlled late RPC timeout");
      return hash;
    } }).processPending();
    let confirmed: Awaited<ReturnType<typeof state>>;
    try {
      await entered.promise;
      await expire(batch.intentId);
      await service().processPending();
      confirmed = await state(batch.intentId);
      assert.equal(confirmed.status, "CONFIRMED");
    } finally { release.release(); await first; }
    assert.deepEqual(await state(batch.intentId), confirmed!);
  });
}

for (const mismatch of ["hash", "chain", "signer", "nonce", "destination", "calldata", "value", "partial"] as const) {
  test(`persisted ${mismatch} mismatch is reconciled without broadcast or nonce reallocation`, async () => {
    const batch = await fixture();
    const saved = await prepared(batch);
    let data: Record<string, unknown>;
    if (mismatch === "hash") data = { transactionHash: keccak256(stringToHex("controlled wrong hash")) };
    else if (mismatch === "chain") data = { transactionChainId: 31338 };
    else if (mismatch === "signer") data = { relayerAddress: rotated.address };
    else if (mismatch === "nonce") data = { relayerNonce: saved.relayerNonce! + 1n };
    else if (mismatch === "partial") data = { signedTransaction: null };
    else {
      const original = parseTransaction(saved.signedTransaction as Hex);
      const transactionData = encodeFunctionData({ abi: evidenceRegistryAbi, functionName: "commitEvidence", args: args(batch) });
      const signed = await account.signTransaction({ chainId: 31337, nonce: Number(saved.relayerNonce), to: mismatch === "destination" ? rotated.address : registry, data: mismatch === "calldata" ? "0x12345678" : transactionData, value: mismatch === "value" ? 1n : 0n, gas: original.gas!, gasPrice: original.gasPrice! });
      data = { signedTransaction: signed, transactionHash: keccak256(signed) };
    }
    await prisma.evidenceAnchorIntent.update({ where: { id: batch.intentId }, data });
    const damaged = await state(batch.intentId);
    let sends = 0;
    await service({ sendRawTransaction: async () => { sends++; throw new Error("unexpected damaged send"); } }).processPending();
    const current = await state(batch.intentId);
    assert.equal(current.status, "RECONCILIATION_REQUIRED");
    assert.equal(current.lastError, "evidence_persisted_transaction_mismatch");
    assert.equal(sends, 0);
    sameTransaction(current, damaged);
    assert.equal((await commitment(batch)).committedAt, 0n);
  });
}

test("fresh publication persists one immutable transaction and confirms complete registry read-back", async () => {
  const batch = await fixture();
  await service().processPending();
  const sent = await state(batch.intentId);
  assert.equal(sent.status, "SUBMITTED");
  assert.equal(keccak256(sent.signedTransaction as Hex), sent.transactionHash);
  assert.equal(sent.relayerNonce, 0n);
  assert.equal(sent.relayerAddress, account.address);
  assert.equal(sent.transactionChainId, 31337);
  const record = await commitment(batch);
  const expected = args(batch);
  assert.deepEqual([record.agreementVersionKey, record.merkleRoot, record.batchDigest, record.schemaVersionHash, record.agreementVersion, record.windowStart, record.windowEnd], expected.slice(1));
  assert.equal(record.reporter, account.address);
  await service().processPending();
  const confirmed = await state(batch.intentId);
  assert.equal(confirmed.status, "CONFIRMED");
  assert.ok(confirmed.confirmedAt);
  assert.equal(confirmed.leaseOwner, null);
  sameTransaction(confirmed, sent);
  await service().processPending();
  assert.equal((await state(batch.intentId)).attemptCount, confirmed.attemptCount);
  assert.equal(await client.getTransactionCount({ address: account.address }), 1);
});

test("restart before broadcast reuses durable signed bytes and nonce", async () => {
  const batch = await fixture();
  const saved = await prepared(batch);
  assert.equal(saved.status, "PENDING");
  assert.equal(saved.lastError, "evidence_rpc_timeout");
  assert.equal(saved.leaseOwner, null);
  assert.equal((await commitment(batch)).committedAt, 0n);
  const sends: Hex[] = [];
  await service({ sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: Hex }) => { sends.push(serializedTransaction); return client.sendRawTransaction({ serializedTransaction }); } }).processPending();
  assert.deepEqual(sends, [saved.signedTransaction]);
  await service().processPending();
  const confirmed = await state(batch.intentId);
  assert.equal(confirmed.status, "CONFIRMED");
  sameTransaction(confirmed, saved);
  assert.equal(await client.getTransactionCount({ address: account.address }), 1);
});

test("timeout after broadcast confirms the existing commitment without another send", async () => {
  const batch = await fixture();
  await service({ sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: Hex }) => { await client.sendRawTransaction({ serializedTransaction }); throw new Error("controlled RPC timeout after broadcast"); } }).processPending();
  const uncertain = await state(batch.intentId);
  assert.equal(uncertain.status, "PENDING");
  assert.equal(uncertain.lastError, "evidence_rpc_timeout");
  assert.ok((await commitment(batch)).committedAt > 0n);
  let sends = 0;
  await service({ sendRawTransaction: async () => { sends++; throw new Error("unexpected duplicate send"); } }).processPending();
  assert.equal(sends, 0);
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
  sameTransaction(await state(batch.intentId), uncertain);
});

test("receipt RPC timeout is uncertainty and never permission to rebroadcast", async () => {
  const batch = await fixture();
  const saved = await prepared(batch);
  let sends = 0;
  await service({ getTransactionReceipt: async () => { throw new Error("controlled receipt RPC timeout"); }, sendRawTransaction: async () => { sends++; return saved.transactionHash; } }).processPending();
  const uncertain = await state(batch.intentId);
  assert.equal(sends, 0);
  assert.equal(uncertain.status, "PENDING");
  assert.equal(uncertain.lastError, "evidence_rpc_timeout");
  sameTransaction(uncertain, saved);
  await service().processPending();
  await service().processPending();
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
});

test("configured confirmation depth is enforced before confirming", async () => {
  const batch = await fixture();
  await service({}, 3).processPending();
  await service({}, 3).processPending();
  assert.equal((await state(batch.intentId)).status, "SUBMITTED");
  assert.equal((await state(batch.intentId)).lastError, "evidence_confirmations_pending");
  assert.equal((await state(batch.intentId)).confirmedAt, null);
  await rpc("evm_mine");
  await service({}, 3).processPending();
  assert.equal((await state(batch.intentId)).status, "SUBMITTED");
  await rpc("evm_mine");
  await service({}, 3).processPending();
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
});

test("publisher rotation does not invalidate an already included historical reporter", async () => {
  const batch = await fixture();
  await service().processPending();
  const saved = await state(batch.intentId);
  await owner.writeContract({ address: registry, abi: rotationAbi, functionName: "setPublisher", args: [rotated.address] });
  await service({}, 1, { EVIDENCE_RELAYER_PRIVATE_KEY: rotatedKey }).processPending();
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
  assert.equal((await commitment(batch)).reporter, account.address);
  sameTransaction(await state(batch.intentId), saved);
});

test("publisher mismatch before preparation requires reconciliation without signing", async () => {
  const batch = await fixture();
  await owner.writeContract({ address: registry, abi: rotationAbi, functionName: "setPublisher", args: [rotated.address] });
  await service().processPending();
  const current = await state(batch.intentId);
  assert.equal(current.status, "RECONCILIATION_REQUIRED");
  assert.equal(current.lastError, "evidence_publisher_configuration_mismatch");
  assert.equal(current.signedTransaction, null);
  assert.equal((await commitment(batch)).committedAt, 0n);
});

test("RPC chain mismatch stops publication before preparing a transaction", async () => {
  const batch = await fixture();
  await service({ getChainId: async () => 31338 }).processPending();
  const current = await state(batch.intentId);
  assert.equal(current.status, "RECONCILIATION_REQUIRED");
  assert.equal(current.lastError, "evidence_registry_unavailable_or_wrong_chain");
  assert.equal(current.signedTransaction, null);
});

test("missing registry code stops publication before preparing a transaction", async () => {
  const batch = await fixture();
  await service({}, 1, { EVIDENCE_REGISTRY_ADDRESS: rotated.address }).processPending();
  assert.equal((await state(batch.intentId)).status, "RECONCILIATION_REQUIRED");
  assert.equal((await state(batch.intentId)).signedTransaction, null);
});

test("broadcast hash mismatch is retained for reconciliation", async () => {
  const batch = await fixture();
  await service({ sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: Hex }) => { await client.sendRawTransaction({ serializedTransaction }); return keccak256(stringToHex("controlled wrong RPC hash")); } }).processPending();
  const current = await state(batch.intentId);
  assert.equal(current.status, "RECONCILIATION_REQUIRED");
  assert.equal(current.lastError, "evidence_transaction_hash_mismatch");
  assert.equal(current.confirmedAt, null);
  assert.equal(keccak256(current.signedTransaction as Hex), current.transactionHash);
});

test("known pending transactions wait for receipts without rebroadcast", async () => {
  const batch = await fixture();
  await rpc("evm_setAutomine", [false]);
  await service().processPending();
  const saved = await state(batch.intentId);
  let sends = 0;
  await service({ sendRawTransaction: async () => { sends++; throw new Error("unexpected rebroadcast"); } }).processPending();
  assert.equal(sends, 0);
  assert.equal((await state(batch.intentId)).status, "SUBMITTED");
  assert.equal((await state(batch.intentId)).lastError, "evidence_receipt_pending");
  await rpc("evm_mine");
  await service().processPending();
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
  sameTransaction(await state(batch.intentId), saved);
});

test("dropped transaction is rebroadcast using identical bytes", async () => {
  const batch = await fixture();
  await rpc("evm_setAutomine", [false]);
  await service().processPending();
  const saved = await state(batch.intentId);
  assert.equal(await rpc("hardhat_dropTransaction", [saved.transactionHash]), true);
  const sends: Hex[] = [];
  await service({ sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: Hex }) => { sends.push(serializedTransaction); return client.sendRawTransaction({ serializedTransaction }); } }).processPending();
  assert.deepEqual(sends, [saved.signedTransaction]);
  await rpc("evm_mine");
  await service().processPending();
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
  sameTransaction(await state(batch.intentId), saved);
});

test("unknown pending replacement waits, and a consumed nonce requires reconciliation", async () => {
  const batch = await fixture();
  await rpc("evm_setAutomine", [false]);
  await service().processPending();
  const saved = await state(batch.intentId);
  const original = parseTransaction(saved.signedTransaction as Hex);
  const replacement = await account.signTransaction({ chainId: 31337, nonce: Number(saved.relayerNonce), to: rotated.address, value: 0n, gas: 21_000n, gasPrice: original.gasPrice! * 2n });
  await client.sendRawTransaction({ serializedTransaction: replacement });
  await service().processPending();
  assert.equal((await state(batch.intentId)).status, "SUBMITTED");
  assert.equal((await state(batch.intentId)).lastError, "evidence_nonce_pending_unknown");
  await rpc("evm_mine");
  await service().processPending();
  const current = await state(batch.intentId);
  assert.equal(current.status, "RECONCILIATION_REQUIRED");
  assert.equal(current.lastError, "evidence_nonce_consumed_without_commitment");
  assert.equal((await commitment(batch)).committedAt, 0n);
  sameTransaction(current, saved);
});

test("reverted included transaction is FAILED and preserves its signed operation", async () => {
  const batch = await fixture();
  await service({ sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: Hex }) => {
    await owner.writeContract({ address: registry, abi: rotationAbi, functionName: "setPublisher", args: [rotated.address] });
    return client.sendRawTransaction({ serializedTransaction });
  } }).processPending();
  const saved = await state(batch.intentId);
  assert.equal((await client.getTransactionReceipt({ hash: saved.transactionHash as Hex })).status, "reverted");
  await service().processPending();
  assert.equal((await state(batch.intentId)).status, "FAILED");
  assert.equal((await state(batch.intentId)).lastError, "evidence_transaction_reverted");
  sameTransaction(await state(batch.intentId), saved);
});

test("a noncanonical receipt is not confirmed", async () => {
  const batch = await fixture();
  await service().processPending();
  await service({ getBlock: async (input: Parameters<typeof client.getBlock>[0]) => ({ ...await client.getBlock(input), hash: keccak256(stringToHex("controlled stale block")) }) }).processPending();
  assert.equal((await state(batch.intentId)).status, "SUBMITTED");
  assert.equal((await state(batch.intentId)).lastError, "evidence_receipt_noncanonical");
  await service().processPending();
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
});

test("a real chain rollback reuses the same signed transaction after its receipt disappears", async () => {
  const batch = await fixture();
  const checkpoint = await rpc("evm_snapshot");
  await service().processPending();
  const saved = await state(batch.intentId);
  assert.equal(await rpc("evm_revert", [checkpoint]), true);
  assert.equal((await commitment(batch)).committedAt, 0n);
  await service().processPending();
  await service().processPending();
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
  sameTransaction(await state(batch.intentId), saved);
});

test("PostgreSQL preparation failure reserves no nonce and broadcasts nothing", async () => {
  const batch = await fixture();
  await databaseFault(batch.intentId, 'NEW."signedTransaction" IS NOT NULL AND OLD."signedTransaction" IS NULL', async () => {
    await service().processPending();
    const current = await state(batch.intentId);
    assert.equal(current.status, "PENDING");
    assert.equal(current.signedTransaction, null);
    assert.equal(current.relayerNonce, null);
    assert.equal(current.leaseOwner, null);
    assert.match(current.lastError!, /^evidence_database_/);
    assert.equal((await commitment(batch)).committedAt, 0n);
  });
  await service().processPending();
  await service().processPending();
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
  assert.equal((await state(batch.intentId)).relayerNonce, 0n);
});

test("PostgreSQL failure after broadcast recovers the included durable transaction", async () => {
  const batch = await fixture();
  await databaseFault(batch.intentId, `NEW."status" = 'SUBMITTED'`, async () => {
    await service().processPending();
    const current = await state(batch.intentId);
    assert.equal(current.status, "PENDING");
    assert.match(current.lastError!, /^evidence_database_/);
    assert.equal((await client.getTransactionReceipt({ hash: current.transactionHash as Hex })).status, "success");
  });
  const saved = await state(batch.intentId);
  await service().processPending();
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
  sameTransaction(await state(batch.intentId), saved);
  assert.equal(await client.getTransactionCount({ address: account.address }), 1);
});

test("failed confirmation persistence rolls back and restart confirms without another send", async () => {
  const batch = await fixture();
  await service().processPending();
  const saved = await state(batch.intentId);
  await databaseFault(batch.intentId, `NEW."status" = 'CONFIRMED'`, async () => {
    await service().processPending();
    const current = await state(batch.intentId);
    assert.equal(current.status, "SUBMITTED");
    assert.equal(current.confirmedAt, null);
    assert.match(current.lastError!, /^evidence_database_/);
  });
  await service().processPending();
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
  sameTransaction(await state(batch.intentId), saved);
});

test("failure-recording outage retains the lease and prepared transaction for durable recovery", async () => {
  const batch = await fixture();
  await databaseFault(batch.intentId, 'NEW."lastError" IS NOT NULL', async () => {
    await service({ sendRawTransaction: async () => { throw new Error("controlled RPC timeout"); } }).processPending();
    const current = await state(batch.intentId);
    assert.equal(current.status, "PENDING");
    assert.ok(current.signedTransaction);
    assert.ok(current.leaseOwner);
    assert.equal(current.lastError, null);
  });
  const saved = await state(batch.intentId);
  await expire(batch.intentId);
  await service().processPending();
  await service().processPending();
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
  sameTransaction(await state(batch.intentId), saved);
});

test("expired lease after preparation prevents broadcast admission", async () => {
  const batch = await fixture();
  await prisma.$executeRawUnsafe(`CREATE FUNCTION expire_publisher_preparation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."id" = '${batch.intentId}'::uuid AND NEW."signedTransaction" IS NOT NULL AND OLD."signedTransaction" IS NULL THEN NEW."leaseUntil" = clock_timestamp(); END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe('CREATE TRIGGER expire_publisher_preparation BEFORE UPDATE ON "EvidenceAnchorIntent" FOR EACH ROW EXECUTE FUNCTION expire_publisher_preparation()');
  try {
    let sends = 0;
    await service({ sendRawTransaction: async () => { sends++; throw new Error("unexpected expired send"); } }).processPending();
    assert.equal(sends, 0);
    assert.ok((await state(batch.intentId)).signedTransaction);
    assert.equal((await commitment(batch)).committedAt, 0n);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER expire_publisher_preparation ON "EvidenceAnchorIntent"');
    await prisma.$executeRawUnsafe('DROP FUNCTION expire_publisher_preparation()');
  }
  const saved = await state(batch.intentId);
  await service().processPending();
  await service().processPending();
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
  sameTransaction(await state(batch.intentId), saved);
});

test("lease is checked after waiting for the nonce advisory lock", { timeout: 15_000 }, async () => {
  const batch = await fixture();
  const ready = barrier();
  const release = barrier();
  let pid = 0;
  const blocker = prisma.$transaction(async (transaction) => {
    const [connection] = await transaction.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    pid = connection.pid;
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(8273642)`;
    ready.release();
    await release.promise;
  });
  await ready.promise;
  const pending = service().processPending();
  try { await waitForBlocked(pid); await expire(batch.intentId); }
  finally { release.release(); await blocker; await pending; }
  assert.equal((await state(batch.intentId)).signedTransaction, null);
  assert.equal((await commitment(batch)).committedAt, 0n);
  await service().processPending();
  await service().processPending();
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
});

test("terminal lease time is checked after a real row-lock wait", { timeout: 15_000 }, async () => {
  const batch = await fixture();
  const entered = barrier();
  const returnBroadcast = barrier();
  const releaseLock = barrier();
  const lockReady = barrier();
  let pid = 0;
  const pending = service({ sendRawTransaction: async (input: Parameters<typeof client.sendRawTransaction>[0]) => { const hash = await client.sendRawTransaction(input); entered.release(); await returnBroadcast.promise; return hash; } }).processPending();
  await entered.promise;
  const blocker = prisma.$transaction(async (transaction) => {
    const [connection] = await transaction.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    pid = connection.pid;
    await transaction.$queryRaw`SELECT "id" FROM "EvidenceAnchorIntent" WHERE "id" = ${batch.intentId}::uuid FOR UPDATE`;
    lockReady.release();
    await releaseLock.promise;
    await transaction.$executeRaw`UPDATE "EvidenceAnchorIntent" SET "leaseUntil" = clock_timestamp() WHERE "id" = ${batch.intentId}::uuid`;
  });
  try { await lockReady.promise; returnBroadcast.release(); await waitForBlocked(pid); }
  finally { releaseLock.release(); returnBroadcast.release(); await blocker; await pending; }
  const saved = await state(batch.intentId);
  assert.equal(saved.status, "PENDING");
  await service().processPending();
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
  sameTransaction(await state(batch.intentId), saved);
});

test("inclusion between commitment read and receipt read never becomes a false conflict", async () => {
  const batch = await fixture();
  await rpc("evm_setAutomine", [false]);
  await service().processPending();
  let mined = false;
  await service({ readContract: async (input: Parameters<typeof client.readContract>[0]) => {
    const result = await client.readContract(input);
    if (input.functionName === "getCommitment" && !mined) { mined = true; await rpc("evm_mine"); }
    return result;
  } }).processPending();
  assert.equal(mined, true);
  assert.equal((await state(batch.intentId)).status, "SUBMITTED");
  assert.equal((await state(batch.intentId)).confirmedAt, null);
  await service().processPending();
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
});

test("inclusion after a transaction-not-found read never becomes a false consumed-nonce conflict", async () => {
  const batch = await fixture();
  await rpc("evm_setAutomine", [false]);
  await service().processPending();
  const saved = await state(batch.intentId);
  assert.equal(await rpc("hardhat_dropTransaction", [saved.transactionHash]), true);
  let mined = false;
  await service({ getTransaction: async (input: Parameters<typeof client.getTransaction>[0]) => {
    try { return await client.getTransaction(input); }
    catch (error) {
      await client.sendRawTransaction({ serializedTransaction: saved.signedTransaction as Hex });
      await rpc("evm_mine");
      mined = true;
      throw error;
    }
  } }).processPending();
  assert.equal(mined, true);
  assert.equal((await state(batch.intentId)).status, "SUBMITTED");
  await service().processPending();
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
  sameTransaction(await state(batch.intentId), saved);
});

test("a shallow reverted receipt remains recoverable across rollback until confirmation depth", async () => {
  const batch = await fixture();
  const checkpoint = await rpc("evm_snapshot");
  await service({ sendRawTransaction: async (input: Parameters<typeof client.sendRawTransaction>[0]) => {
    await owner.writeContract({ address: registry, abi: rotationAbi, functionName: "setPublisher", args: [rotated.address] });
    return client.sendRawTransaction(input);
  } }, 3).processPending();
  const saved = await state(batch.intentId);
  assert.equal((await client.getTransactionReceipt({ hash: saved.transactionHash as Hex })).status, "reverted");
  await service({}, 3).processPending();
  const waiting = await state(batch.intentId);
  assert.notEqual(waiting.status, "FAILED");
  assert.equal(waiting.lastError, "evidence_confirmations_pending");
  assert.equal(await rpc("evm_revert", [checkpoint]), true);
  await service({}, 3).processPending();
  await rpc("evm_mine");
  await rpc("evm_mine");
  await service({}, 3).processPending();
  assert.equal((await state(batch.intentId)).status, "CONFIRMED");
  sameTransaction(await state(batch.intentId), saved);
});

import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { after, afterEach, before, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { createPublicClient, createWalletClient, defineChain, http, keccak256, stringToHex, type Address, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AgreementAnchoringService } from "../../src/blockchain/agreement-anchoring.service.js";
import { AgreementSigningService } from "../../src/agreements/agreement-signing.service.js";
import { agreementApprovalTypedData, canonicalizeAgreementSnapshot } from "../../src/blockchain/agreement-hash.service.js";
import { agreementRegistryAbi } from "../../src/blockchain/agreement-registry.abi.js";
import { MonitoringAccessService } from "../../src/monitoring/monitoring-access.service.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
const rpcUrl = process.env.ANCHOR_TEST_RPC_URL ?? "";
const chainId = Number(process.env.ANCHOR_TEST_CHAIN_ID ?? 0);
const registryAddress = process.env.ANCHOR_TEST_REGISTRY_ADDRESS as Address | undefined;
const relayerKey = process.env.ANCHOR_TEST_RELAYER_PRIVATE_KEY as `0x${string}` | undefined;
const buyer = privateKeyToAccount(`0x${"11".repeat(32)}`);
const supplier = privateKeyToAccount(`0x${"22".repeat(32)}`);
const signerPasswordHash = "test-only-not-a-credential";

assert.match(new URL(databaseUrl).pathname.replace(/^\//, ""), /_test$/, "anchor integration tests require a dedicated _test database");
assert.ok(rpcUrl && chainId > 0 && registryAddress && relayerKey, "anchor integration tests require a local EVM and deployed registry");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(rpcUrl).hostname), "anchor tests only permit loopback EVMs");
assert.equal(chainId, 31337, "anchor tests only permit the isolated Hardhat chain");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const chain = defineChain({ id: chainId, name: "SLA-DEX local EVM", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
const chainClient = createPublicClient({ chain, transport: http(rpcUrl), cacheTime: 0 });
const relayer = privateKeyToAccount(relayerKey!);
const relayerWallet = createWalletClient({ account: relayer, chain, transport: http(rpcUrl) });
const fixtures: Array<{ agreementId: string; organizationIds: string[]; userIds: string[] }> = [];

type RpcOverrides = Partial<Record<string, (...args: never[]) => unknown>>;

function controlledClient(overrides: RpcOverrides = {}) {
  return new Proxy(chainClient, {
    get(target, property, receiver) {
      if (typeof property === "string" && property in overrides) return overrides[property];
      return Reflect.get(target, property, receiver) as unknown;
    }
  }) as PublicClient;
}

function service(client: PublicClient = chainClient, database: PrismaClient = prisma, contextChainId = chainId, confirmations = 1) {
  const blockchain = {
    isAnchorConfigured: () => true,
    getSigningContext: async () => {
      const actualChainId = await client.getChainId();
      if (actualChainId !== contextChainId) throw new Error("configured blockchain RPC returned an unexpected chain ID");
      return { client, chainId: contextChainId, registryAddress: registryAddress!, rpcUrl };
    },
    getRelayerAccount: () => relayer,
    getConfirmationCount: () => confirmations
  };
  return new AgreementAnchoringService(database as never, blockchain as never);
}

async function createFixture(options: { expiresAt?: number } = {}) {
  const suffix = randomUUID();
  const fixture = { agreementId: randomUUID(), organizationIds: [] as string[], userIds: [] as string[] };
  fixtures.push(fixture);
  const buyerUser = await prisma.user.create({ data: { email: `${suffix}-buyer@example.test`, passwordHash: signerPasswordHash, displayName: "Test Buyer" } });
  fixture.userIds.push(buyerUser.id);
  const supplierUser = await prisma.user.create({ data: { email: `${suffix}-supplier@example.test`, passwordHash: signerPasswordHash, displayName: "Test Supplier" } });
  fixture.userIds.push(supplierUser.id);
  const buyerOrganization = await prisma.organization.create({ data: { name: `${suffix}-buyer`, organizationType: "CUSTOMER", memberships: { create: { userId: buyerUser.id, role: "OWNER" } } } });
  fixture.organizationIds.push(buyerOrganization.id);
  const supplierOrganization = await prisma.organization.create({ data: { name: `${suffix}-supplier`, organizationType: "PROVIDER", memberships: { create: { userId: supplierUser.id, role: "OWNER" } } } });
  fixture.organizationIds.push(supplierOrganization.id);
  const buyerSigner = await prisma.authorizedSigner.create({ data: { organizationId: buyerOrganization.id, userId: buyerUser.id, address: buyer.address } });
  const supplierSigner = await prisma.authorizedSigner.create({ data: { organizationId: supplierOrganization.id, userId: supplierUser.id, address: supplier.address } });
  const agreementId = fixture.agreementId;
  const version = 1;
  const validUntil = options.expiresAt ?? Math.floor(Date.now() / 1000) + 600;
  const input = {
    agreementId,
    reference: `T-${suffix.slice(0, 12)}`,
    version,
    buyerOrganizationId: buyerOrganization.id,
    supplierOrganizationId: supplierOrganization.id,
    name: "Isolated anchor test",
    serviceDescription: "Local EVM reliability test",
    uptimeTargetBasisPoints: 9995,
    responseTimeTargetMs: 180,
    measurementWindowHours: 24,
    exclusions: ["scheduled maintenance"],
    notes: null,
    buyerSigner: buyer.address,
    supplierSigner: supplier.address,
    validUntil
  };
  const canonical = canonicalizeAgreementSnapshot(input);
  const typedData = agreementApprovalTypedData(canonical, chainId, registryAddress!, 1n, validUntil);
  const [buyerSignature, supplierSignature] = await Promise.all([buyer.signTypedData(typedData), supplier.signTypedData(typedData)]);
  await prisma.agreement.create({
    data: {
      id: agreementId,
      reference: input.reference,
      ownerOrganizationId: buyerOrganization.id,
      createdByUserId: buyerUser.id,
      status: "ANCHOR_PENDING",
      signatureStatus: "COMPLETE",
      blockchainStatus: "QUEUED",
      version,
      versions: { create: { version, actorUserId: buyerUser.id, name: input.name, serviceDescription: input.serviceDescription, counterpartyDisplayName: supplierOrganization.name, uptimeTargetPercent: "99.95", responseTimeTargetMs: input.responseTimeTargetMs, measurementWindowHours: input.measurementWindowHours, exclusions: input.exclusions, notes: input.notes } },
      participants: { create: [
        { agreementVersion: version, organizationId: buyerOrganization.id, role: "BUYER", authorizedSignerId: buyerSigner.id },
        { agreementVersion: version, organizationId: supplierOrganization.id, role: "SUPPLIER", authorizedSignerId: supplierSigner.id }
      ] }
    }
  });
  const snapshot = await prisma.signingSnapshot.create({
    data: {
      agreementId,
      version,
      buyerOrganizationId: buyerOrganization.id,
      supplierOrganizationId: supplierOrganization.id,
      buyerSigner: buyer.address,
      supplierSigner: supplier.address,
      buyerAuthorizedSignerId: buyerSigner.id,
      supplierAuthorizedSignerId: supplierSigner.id,
      canonicalPayload: canonical.canonicalJson,
      snapshotHash: canonical.hash,
      agreementKey: canonical.key,
      nonce: 1n,
      validUntil: new Date(validUntil * 1000),
      signatureStatus: "COMPLETE",
      signatures: { create: [
        { party: "BUYER", authorizedSignerId: buyerSigner.id, signerAddress: buyer.address, signature: buyerSignature, digest: keccak256(stringToHex(canonical.canonicalJson)) },
        { party: "SUPPLIER", authorizedSignerId: supplierSigner.id, signerAddress: supplier.address, signature: supplierSignature, digest: keccak256(stringToHex(canonical.canonicalJson)) }
      ] },
      anchorIntent: { create: { idempotencyKey: canonical.key.slice(2), status: "QUEUED" } }
    },
    include: { anchorIntent: true, signatures: true }
  });
  return { agreementId, snapshot, input, canonical, typedData, buyerUserId: buyerUser.id };
}

async function state(agreementId: string) {
  return prisma.anchorIntent.findFirstOrThrow({ where: { snapshot: { agreementId } }, include: { snapshot: true } });
}

async function registryRecord(agreementKey: `0x${string}`) {
  return chainClient.readContract({ address: registryAddress!, abi: agreementRegistryAbi, functionName: "getAgreement", args: [agreementKey] });
}

async function mine() {
  await hardhatRpc("evm_mine");
}

async function hardhatRpc(method: string, params: unknown[] = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params })
  });
  const payload = await response.json() as { result?: unknown; error?: { message: string } };
  if (!response.ok || payload.error) throw new Error(payload.error?.message ?? `Hardhat RPC request failed: ${method}`);
  return payload.result;
}

before(async () => {
  await prisma.$connect();
  assert.equal(await chainClient.getChainId(), chainId, "the configured local EVM must report the expected chain ID");
  assert.notEqual(await chainClient.getCode({ address: registryAddress! }), "0x", "the local registry must be deployed");
});

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await prisma.auditEvent.deleteMany({ where: { resourceType: "agreement", resourceId: fixture.agreementId } });
    await prisma.anchorIntent.deleteMany({ where: { snapshot: { agreementId: fixture.agreementId } } });
    await prisma.signingSnapshot.deleteMany({ where: { agreementId: fixture.agreementId } });
    await prisma.agreement.deleteMany({ where: { id: fixture.agreementId } });
    await prisma.organization.deleteMany({ where: { id: { in: fixture.organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: fixture.userIds } } });
  }
});
after(() => prisma.$disconnect());

test("R02 RPC timeout after broadcast keeps the persisted transaction and restart confirms it", async () => {
  const fixture = await createFixture();
  const timedClient = controlledClient({ sendRawTransaction: (async ({ serializedTransaction }: { serializedTransaction: `0x${string}` }) => {
    const hash = await chainClient.sendRawTransaction({ serializedTransaction });
    throw Object.assign(new Error("timeout after broadcast"), { cause: hash });
  }) as never });
  await service(timedClient).processPendingIntents();
  const uncertain = await state(fixture.agreementId);
  assert.equal(uncertain.status, "SUBMISSION_UNCERTAIN");
  assert.equal((await registryRecord(fixture.canonical.key as `0x${string}`)).agreementHash, fixture.canonical.hash);
  await service().processPendingIntents();
  assert.equal((await state(fixture.agreementId)).status, "CONFIRMED");
});

test("R03 an included transaction is reconciled after recreating the worker", async () => {
  const fixture = await createFixture();
  let crashed = false;
  const crashAfterInclusion = controlledClient({ sendRawTransaction: (async ({ serializedTransaction }: { serializedTransaction: `0x${string}` }) => {
    const hash = await chainClient.sendRawTransaction({ serializedTransaction });
    if (!crashed) { crashed = true; throw new Error("worker stopped after inclusion"); }
    return hash;
  }) as never });
  await service(crashAfterInclusion).processPendingIntents();
  assert.equal((await state(fixture.agreementId)).status, "SUBMISSION_UNCERTAIN");
  await service().processPendingIntents();
  assert.equal((await state(fixture.agreementId)).status, "CONFIRMED");
  assert.equal((await registryRecord(fixture.canonical.key as `0x${string}`)).agreementHash, fixture.canonical.hash);
});

test("R04 database failure after an included send leaves a recoverable intent", async () => {
  const fixture = await createFixture();
  let failUpdate = true;
  const intercepted = new Proxy(prisma, {
    get(target, property, receiver) {
      if (property !== "$transaction") return Reflect.get(target, property, receiver) as unknown;
      return async (callback: (tx: unknown) => Promise<unknown>, options?: unknown) => target.$transaction(async (tx) => callback(new Proxy(tx, {
        get(transaction, member, txReceiver) {
          if (member !== "anchorIntent") return Reflect.get(transaction, member, txReceiver) as unknown;
          const intents = Reflect.get(transaction, member, txReceiver) as unknown as Record<string, unknown>;
          return new Proxy(intents, { get(delegate, method, delegateReceiver) {
            if (method !== "updateMany") return Reflect.get(delegate, method, delegateReceiver) as unknown;
            return async (args: { data?: { status?: string } }) => {
              if (failUpdate && args.data?.status === "SUBMITTED") { failUpdate = false; throw new Error("simulated database update failure"); }
              return (Reflect.get(delegate, method, delegateReceiver) as (a: unknown) => Promise<unknown>)(args);
            };
          } });
        }
      })), options as never);
    }
  });
  await service(chainClient, intercepted).processPendingIntents();
  assert.equal((await registryRecord(fixture.canonical.key as `0x${string}`)).agreementHash, fixture.canonical.hash);
  const uncertain = await state(fixture.agreementId);
  assert.equal(uncertain.status, "SUBMISSION_UNCERTAIN");
  assert.equal((await chainClient.getTransactionReceipt({ hash: uncertain.transactionHash as `0x${string}` })).status, "success");
  await service().processPendingIntents();
  assert.equal((await state(fixture.agreementId)).status, "CONFIRMED");
});

test("R05 a new worker resumes an uncertain persisted submission without allocating a new nonce", async () => {
  const fixture = await createFixture();
  const uncertain = controlledClient({ sendRawTransaction: (async ({ serializedTransaction }: { serializedTransaction: `0x${string}` }) => {
    await chainClient.sendRawTransaction({ serializedTransaction });
    throw new Error("network timeout");
  }) as never });
  await service(uncertain).processPendingIntents();
  const prior = await state(fixture.agreementId);
  const newWorker = service();
  await newWorker.processPendingIntents();
  const resumed = await state(fixture.agreementId);
  assert.equal(resumed.status, "CONFIRMED");
  assert.equal(resumed.relayerNonce, prior.relayerNonce);
  assert.equal(resumed.transactionHash, prior.transactionHash);
});

test("R06 concurrent workers claim one database lease for an intent", async () => {
  const fixture = await createFixture();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let held = false;
  const waitingClient = controlledClient({ readContract: (async (args: never) => {
    if (!held) { held = true; entered(); await gate; }
    return chainClient.readContract(args as never);
  }) as never });
  const first = service(waitingClient).processPendingIntents();
  await started;
  await service().processPendingIntents();
  assert.equal((await state(fixture.agreementId)).attemptCount, 1);
  release();
  await first;
  assert.equal((await state(fixture.agreementId)).status, "SUBMITTED");
});

test("R07 duplicate processing of one logical agreement creates one intent and one registry record", async () => {
  const fixture = await createFixture();
  const intentBefore = await state(fixture.agreementId);
  assert.equal(intentBefore.status, "QUEUED");
  const signing = new AgreementSigningService(prisma as never, {
    getSigningContext: async () => ({ client: chainClient, chainId, registryAddress: registryAddress!, rpcUrl }),
    getConfiguredDomain: () => ({ chainId, registryAddress: registryAddress! })
  } as never);
  await assert.rejects(signing.submitSignature({
    user: { id: fixture.buyerUserId },
    organization: { id: (await prisma.agreement.findUniqueOrThrow({ where: { id: fixture.agreementId } })).ownerOrganizationId, role: "OWNER" }
  } as never, fixture.agreementId, fixture.snapshot.signatures.find(({ party }) => party === "BUYER")!.signature as `0x${string}`));
  await Promise.all([service().processPendingIntents(), service().processPendingIntents()]);
  assert.equal(await prisma.anchorIntent.count({ where: { snapshotId: fixture.snapshot.id } }), 1);
  assert.equal((await registryRecord(fixture.canonical.key as `0x${string}`)).agreementHash, fixture.canonical.hash);
  const submitted = await state(fixture.agreementId);
  assert.equal(submitted.status, "SUBMITTED");
  assert.equal(submitted.leaseOwner, null);
  assert.equal(submitted.leaseUntil, null);
  await service().processPendingIntents();
  assert.equal((await state(fixture.agreementId)).status, "CONFIRMED");
});

test("R09 dropped transactions rebroadcast identical bytes while replacements stay separate", async () => {
  const dropped = await createFixture();
  const rejectBeforeSend = controlledClient({ sendRawTransaction: (async () => { throw new Error("invalid sender"); }) as never });
  await service(rejectBeforeSend).processPendingIntents();
  const stored = await state(dropped.agreementId);
  await service().retry(context(dropped), dropped.agreementId);
  assert.equal((await prisma.agreement.findUniqueOrThrow({ where: { id: dropped.agreementId } })).status, "ANCHOR_PENDING");
  await service().processPendingIntents();
  const rebroadcast = await state(dropped.agreementId);
  assert.equal(rebroadcast.transactionHash, stored.transactionHash);
  assert.equal(rebroadcast.relayerNonce, stored.relayerNonce);
  assert.equal(rebroadcast.status, "SUBMITTED");
  await service().processPendingIntents();
  assert.equal((await state(dropped.agreementId)).status, "CONFIRMED");

  const replaced = await createFixture();
  await hardhatRpc("evm_setAutomine", [false]);
  try {
    await service().processPendingIntents();
    const original = await state(replaced.agreementId);
    const originalTransaction = await chainClient.getTransaction({ hash: original.transactionHash as `0x${string}` });
    assert.ok(originalTransaction, "the original transaction is pending before replacement");
    const replacement = await relayer.signTransaction({
      chainId,
      nonce: Number(original.relayerNonce),
      to: buyer.address,
      value: 0n,
      gas: 21_000n,
      gasPrice: (originalTransaction.gasPrice ?? 1n) * 2n
    });
    await chainClient.sendRawTransaction({ serializedTransaction: replacement });
    const pendingNonce = await chainClient.getTransactionCount({ address: relayer.address, blockTag: "pending" });
    const latestNonce = await chainClient.getTransactionCount({ address: relayer.address, blockTag: "latest" });
    assert.equal(pendingNonce, Number(original.relayerNonce) + 1);
    assert.equal(latestNonce, Number(original.relayerNonce));
    await service().processPendingIntents();
    const pendingReplacement = await state(replaced.agreementId);
    assert.equal(pendingReplacement.status, "SUBMISSION_UNCERTAIN");
    assert.equal(pendingReplacement.lastError, "replacement_pending_unknown");
    await mine();
    await service().processPendingIntents();
    const discovered = await state(replaced.agreementId);
    assert.equal(discovered.status, "REPLACED");
    assert.ok(discovered.replacementHash);
    assert.notEqual(discovered.replacementHash, discovered.transactionHash);
    await service().processPendingIntents();
    assert.equal((await state(replaced.agreementId)).status, "RECONCILIATION_REQUIRED");
  } finally {
    await hardhatRpc("evm_setAutomine", [true]);
  }
});

test("R08 an EVM revert is recorded as failed with a reverted receipt", async () => {
  const fixture = await createFixture({ expiresAt: Math.floor(Date.now() / 1000) - 30 });
  const allowingEstimate = controlledClient({ estimateContractGas: async () => 100_000n as never });
  await service(allowingEstimate).processPendingIntents();
  await service(allowingEstimate).processPendingIntents();
  const intent = await state(fixture.agreementId);
  assert.equal(intent.status, "FAILED");
  assert.equal(intent.lastError, "transaction_reverted");
  assert.ok(intent.transactionHash);
  assert.equal((await chainClient.getTransactionReceipt({ hash: intent.transactionHash as `0x${string}` })).status, "reverted");
  assert.equal((await registryRecord(fixture.canonical.key as `0x${string}`)).registeredAt, 0n);
});

test("R10 an external matching record requires reconciliation without a duplicate transaction", async () => {
  const fixture = await createFixture();
  const before = await chainClient.getTransactionCount({ address: relayer.address });
  const registrationHash = await relayerWallet.writeContract({ address: registryAddress!, abi: agreementRegistryAbi, functionName: "registerAgreement", args: [fixture.typedData.message, (await buyer.signTypedData(fixture.typedData)), (await supplier.signTypedData(fixture.typedData))] });
  await chainClient.waitForTransactionReceipt({ hash: registrationHash });
  assert.equal((await registryRecord(fixture.canonical.key as `0x${string}`)).agreementHash, fixture.canonical.hash);
  await service().processPendingIntents();
  const intent = await state(fixture.agreementId);
  assert.equal(intent.status, "RECONCILIATION_REQUIRED");
  assert.equal(intent.lastError, "external_registration_without_proof");
  assert.equal(intent.transactionHash, null);
  assert.equal(intent.relayerNonce, null);
  assert.equal(intent.signedTransaction, null);
  assert.equal((await prisma.agreement.findUniqueOrThrow({ where: { id: fixture.agreementId } })).status, "ANCHOR_PENDING");
  assert.equal(await chainClient.getTransactionCount({ address: relayer.address }), before + 1);
});

test("R11 a wrong RPC chain ID leaves the intent queued and submits nothing", async () => {
  const fixture = await createFixture();
  const mismatched = service(chainClient, prisma, chainId + 1);
  await mismatched.processPendingIntents();
  const intent = await state(fixture.agreementId);
  assert.equal(intent.status, "QUEUED");
  assert.equal(intent.transactionHash, null);
  assert.equal((await registryRecord(fixture.canonical.key as `0x${string}`)).registeredAt, 0n);
});

test("R12 a registry record with a mismatched agreement hash requires reconciliation", async () => {
  const fixture = await createFixture();
  const altered = { ...fixture.typedData.message, agreementHash: `0x${"ab".repeat(32)}` as `0x${string}` };
  const alteredTypedData = { ...fixture.typedData, message: altered };
  await relayerWallet.writeContract({ address: registryAddress!, abi: agreementRegistryAbi, functionName: "registerAgreement", args: [altered, await buyer.signTypedData(alteredTypedData), await supplier.signTypedData(alteredTypedData)] });
  await service().processPendingIntents();
  const intent = await state(fixture.agreementId);
  assert.equal(intent.status, "RECONCILIATION_REQUIRED");
  assert.equal(intent.lastError, "registry_record_mismatch");
  assert.notEqual((await registryRecord(fixture.canonical.key as `0x${string}`)).agreementHash, fixture.canonical.hash);
});

test("R01 RPC rejection persists a failed signed intent without on-chain registration", async () => {
  const fixture = await createFixture();
  const rejectingClient = controlledClient({ sendRawTransaction: (async () => { throw new Error("invalid sender"); }) as never });
  await service(rejectingClient).processPendingIntents();
  const intent = await state(fixture.agreementId);
  assert.equal(intent.status, "FAILED");
  assert.equal(intent.lastError, "rpc_rejected");
  assert.equal(intent.attemptCount, 1);
  assert.ok(intent.signedTransaction);
  assert.equal((await registryRecord(fixture.canonical.key as `0x${string}`)).registeredAt, 0n);
  await service().retry(context(fixture), fixture.agreementId);
  assert.equal((await prisma.agreement.findUniqueOrThrow({ where: { id: fixture.agreementId } })).status, "ANCHOR_PENDING");
  await service().processPendingIntents();
  const rebroadcast = await state(fixture.agreementId);
  assert.equal(rebroadcast.status, "SUBMITTED");
  assert.equal(rebroadcast.transactionHash, intent.transactionHash);
  await service().processPendingIntents();
  assert.equal((await state(fixture.agreementId)).status, "CONFIRMED");
});

function context(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return { user: { id: fixture.buyerUserId }, organization: { id: fixture.snapshot.buyerOrganizationId, role: "OWNER" } } as never;
}

async function durableState(agreementId: string) {
  return { intent: await state(agreementId), agreement: await prisma.agreement.findUniqueOrThrow({ where: { id: agreementId } }) };
}

test("N=3 confirms only at H+2 with stable identity and read-only concurrent verification", async (t) => {
  const fixture = await createFixture();
  const worker = () => service(chainClient, prisma, chainId, 3);
  const monitoring = new MonitoringAccessService(prisma as never, { get: () => chainId } as never);
  const nonceBefore = await chainClient.getTransactionCount({ address: relayer.address });
  await worker().processPendingIntents();
  const submitted = await state(fixture.agreementId);
  const receipt = await chainClient.getTransactionReceipt({ hash: submitted.transactionHash as `0x${string}` });
  const observations: unknown[] = [];
  for (const depth of [1, 2, 3]) {
    const head = await chainClient.getBlockNumber({ cacheTime: 0 });
    assert.equal(head, receipt.blockNumber + BigInt(depth - 1));
    const before = await durableState(fixture.agreementId);
    const results = await Promise.all([worker().verifyAgreement(context(fixture), fixture.agreementId), worker().verifyAgreement(context(fixture), fixture.agreementId)]);
    for (const proof of results) {
      assert.equal(proof.verified, depth === 3);
      assert.equal(proof.durableConfirmed, false);
      assert.equal(proof.confirmations, depth);
      assert.equal(proof.requiredConfirmations, 3);
    }
    assert.ok(isDeepStrictEqual(await durableState(fixture.agreementId), before), "API verification must not update any durable field");
    await assert.rejects(monitoring.requireActiveAgreement(context(fixture), fixture.agreementId));
    await Promise.all([worker().processPendingIntents(), worker().processPendingIntents()]);
    const current = await state(fixture.agreementId);
    assert.equal(current.status, depth === 3 ? "CONFIRMED" : "SUBMITTED");
    assert.equal(current.transactionHash, submitted.transactionHash);
    assert.ok(current.signedTransaction === submitted.signedTransaction, "original signed bytes remain identical");
    assert.equal(current.relayerNonce, submitted.relayerNonce);
    observations.push({ receiptBlock: receipt.blockNumber.toString(), head: head.toString(), depth, status: current.status, transactionHash: current.transactionHash, nonce: current.relayerNonce?.toString() });
    if (depth < 3) await mine();
  }
  await monitoring.requireActiveAgreement(context(fixture), fixture.agreementId);
  assert.equal((await worker().verifyAgreement(context(fixture), fixture.agreementId)).durableConfirmed, true);
  assert.equal(await chainClient.getTransactionCount({ address: relayer.address }), nonceBefore + 1);
  const events = await chainClient.getContractEvents({ address: registryAddress!, abi: agreementRegistryAbi, eventName: "AgreementRegistered", args: { agreementKey: fixture.canonical.key }, fromBlock: 0n, toBlock: "latest" });
  assert.equal(events.length, 1);
  t.diagnostic(`N3_BLOCK_EVIDENCE ${JSON.stringify(observations)}`);
});

test("N=3 waits for canonical revert depth before atomically failing", async () => {
  const fixture = await createFixture({ expiresAt: Math.floor(Date.now() / 1000) - 30 });
  const client = controlledClient({ estimateContractGas: async () => 100_000n as never });
  const worker = () => service(client, prisma, chainId, 3);
  await worker().processPendingIntents();
  const original = await state(fixture.agreementId);
  assert.equal((await chainClient.getTransactionReceipt({ hash: original.transactionHash as `0x${string}` })).status, "reverted");
  assert.ok(["SUBMITTED", "SUBMISSION_UNCERTAIN"].includes(original.status));
  for (const depth of [1, 2, 3]) {
    await worker().processPendingIntents();
    const current = await durableState(fixture.agreementId);
    assert.equal(current.intent.status, depth === 3 ? "FAILED" : original.status);
    assert.equal(current.agreement.status, depth === 3 ? "ANCHOR_FAILED" : "ANCHOR_PENDING");
    assert.equal(current.intent.transactionHash, original.transactionHash);
    if (depth < 3) await mine();
  }
});

test("API verification held across worker confirmation cannot overwrite its durable result", async () => {
  const fixture = await createFixture();
  await service().processPendingIntents();
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const client = controlledClient({ getTransactionReceipt: (async (args: { hash: `0x${string}` }) => {
    const receipt = await chainClient.getTransactionReceipt(args);
    enter(); await gate; return receipt;
  }) as never });
  const verification = service(client).verifyAgreement(context(fixture), fixture.agreementId);
  try {
    await entered;
    await service().processPendingIntents();
    const committed = await durableState(fixture.agreementId);
    assert.equal(committed.intent.status, "CONFIRMED");
    assert.ok(committed.intent.confirmedAt);
    release();
    const result = await verification;
    assert.equal(result.verified, true);
    assert.equal(result.durableConfirmed, false, "the response separates its earlier DB observation from sufficient chain proof");
    assert.ok(isDeepStrictEqual(await durableState(fixture.agreementId), committed), "API verification cannot alter the worker commit");
  } finally { release(); await verification; }
});

for (const fault of ["missing", "timeout", "unavailable", "noncanonical", "head_changed"] as const) {
  test(`included owned transaction survives ${fault} and a worker restart`, async () => {
    const fixture = await createFixture();
    await service().processPendingIntents();
    const original = await state(fixture.agreementId);
    let reads = 0;
    const client = controlledClient(fault === "head_changed" ? {
      getBlock: (async (args: Parameters<PublicClient["getBlock"]>[0]) => {
        const block = await chainClient.getBlock(args);
        return { ...block, hash: ++reads >= 3 ? `0x${"ff".repeat(32)}` : block.hash };
      }) as never
    } : {
      getTransactionReceipt: (async (args: { hash: `0x${string}` }) => {
        if (fault === "missing") throw Object.assign(new Error("controlled missing receipt"), { name: "TransactionReceiptNotFoundError" });
        if (fault === "timeout") throw new Error("controlled RPC timeout");
        if (fault === "unavailable") throw new Error("controlled HTTP service unavailable");
        return { ...await chainClient.getTransactionReceipt(args), blockHash: `0x${"ff".repeat(32)}` };
      }) as never
    });
    const before = await durableState(fixture.agreementId);
    assert.equal((await service(client).verifyAgreement(context(fixture), fixture.agreementId)).verified, false);
    assert.ok(isDeepStrictEqual(await durableState(fixture.agreementId), before), "fault verification is read-only");
    reads = 0;
    await service(client).processPendingIntents();
    assert.equal((await state(fixture.agreementId)).status, "SUBMITTED");
    await service().processPendingIntents();
    const recovered = await state(fixture.agreementId);
    assert.equal(recovered.status, "CONFIRMED");
    assert.equal(recovered.transactionHash, original.transactionHash);
    assert.equal(recovered.relayerNonce, original.relayerNonce);
  });
}

for (const takeover of [false, true]) {
  test(`stale finalization is rejected after lease ${takeover ? "takeover" : "expiry"}`, async () => {
    const fixture = await createFixture();
    await service().processPendingIntents();
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const client = controlledClient({ getTransactionReceipt: (async (args: { hash: `0x${string}` }) => {
      const receipt = await chainClient.getTransactionReceipt(args);
      enter(); await gate; return receipt;
    }) as never });
    const pending = service(client).processPendingIntents();
    try {
      await entered;
      const leased = await state(fixture.agreementId);
      await prisma.$executeRaw`UPDATE "AnchorIntent" SET "leaseUntil" = clock_timestamp() - interval '1 second' WHERE "id" = ${leased.id}::uuid`;
      if (takeover) await service().processPendingIntents();
      const before = await durableState(fixture.agreementId);
      assert.equal(before.intent.status, takeover ? "CONFIRMED" : "SUBMITTED");
      release(); await pending;
      assert.ok(isDeepStrictEqual(await durableState(fixture.agreementId), before), "stale worker cannot clear a lease or partially update the agreement");
    } finally { release(); await pending; }
    if (!takeover) await service().processPendingIntents();
    assert.equal((await state(fixture.agreementId)).status, "CONFIRMED");
  });
}

test("an agreement version changed while proof is read cannot be finalized by the old worker", async () => {
  const fixture = await createFixture();
  await service().processPendingIntents();
  let changed = false;
  const client = controlledClient({ getTransactionReceipt: (async (args: { hash: `0x${string}` }) => {
    if (!changed) {
      changed = true;
      await prisma.agreement.update({ where: { id: fixture.agreementId }, data: { version: 2, status: "DRAFT", blockchainStatus: "NOT_QUEUED" } });
    }
    return chainClient.getTransactionReceipt(args);
  }) as never });
  await service(client).processPendingIntents();
  assert.equal((await state(fixture.agreementId)).status, "SUBMITTED");
  const agreement = await prisma.agreement.findUniqueOrThrow({ where: { id: fixture.agreementId } });
  assert.equal(agreement.version, 2);
  assert.equal(agreement.status, "DRAFT");
  assert.equal(agreement.blockchainStatus, "NOT_QUEUED");
});

test("a database error between finalization writes rolls back both rows and restart recovers", async () => {
  const fixture = await createFixture();
  await service().processPendingIntents();
  let fail = true;
  const database = new Proxy(prisma, { get(target, property, receiver) {
    if (property !== "$transaction") return Reflect.get(target, property, receiver) as unknown;
    return async (callback: (tx: unknown) => Promise<unknown>) => target.$transaction(async (tx) => callback(new Proxy(tx, { get(transaction, member, txReceiver) {
      if (member !== "agreement") return Reflect.get(transaction, member, txReceiver) as unknown;
      return new Proxy(transaction.agreement, { get(delegate, method, delegateReceiver) {
        if (method !== "updateMany") return Reflect.get(delegate, method, delegateReceiver) as unknown;
        return async (args: { data?: { status?: string } }) => {
          if (fail && args.data?.status === "ANCHOR_CONFIRMED") { fail = false; throw new Error("controlled database failure"); }
          return delegate.updateMany(args as never);
        };
      } });
    } })));
  } });
  await service(chainClient, database).processPendingIntents();
  const rolledBack = await durableState(fixture.agreementId);
  assert.equal(rolledBack.intent.status, "SUBMITTED");
  assert.equal(rolledBack.agreement.status, "ANCHOR_PENDING");
  await service().processPendingIntents();
  assert.equal((await state(fixture.agreementId)).status, "CONFIRMED");
});

test("a valid mined replacement uses depth proof while preserving the original hash and bytes", async () => {
  const fixture = await createFixture();
  await hardhatRpc("evm_setAutomine", [false]);
  let original: Awaited<ReturnType<typeof state>>;
  try {
    await service().processPendingIntents();
    original = await state(fixture.agreementId);
    const tx = await chainClient.getTransaction({ hash: original.transactionHash as `0x${string}` });
    const replacement = await relayer.signTransaction({ chainId, nonce: tx.nonce, to: registryAddress!, value: 0n, data: tx.input, gas: tx.gas, gasPrice: tx.gasPrice! * 2n });
    await chainClient.sendRawTransaction({ serializedTransaction: replacement });
    await mine();
  } finally { await hardhatRpc("evm_setAutomine", [true]); }
  await service(chainClient, prisma, chainId, 3).processPendingIntents();
  const discovered = await state(fixture.agreementId);
  assert.equal(discovered.status, "REPLACED");
  assert.ok(discovered.replacementHash);
  await service(chainClient, prisma, chainId, 3).processPendingIntents();
  assert.equal((await state(fixture.agreementId)).status, "REPLACED");
  await mine(); await mine();
  await service(chainClient, prisma, chainId, 3).processPendingIntents();
  const confirmed = await state(fixture.agreementId);
  assert.equal(confirmed.status, "CONFIRMED");
  assert.equal(confirmed.transactionHash, original!.transactionHash);
  assert.ok(confirmed.signedTransaction === original!.signedTransaction, "replacement preserves original signed bytes");
  assert.equal(confirmed.relayerNonce, original!.relayerNonce);
  assert.equal(confirmed.replacementHash, discovered.replacementHash);
});

test("an owned revert behind another valid registration waits for depth then reconciles", async () => {
  const fixture = await createFixture();
  const accounts = await hardhatRpc("eth_accounts") as Address[];
  assert.ok(accounts[1] && accounts[1].toLowerCase() !== relayer.address.toLowerCase());
  const external = createWalletClient({ account: accounts[1], chain, transport: http(rpcUrl) });
  await hardhatRpc("evm_setAutomine", [false]);
  let original: Awaited<ReturnType<typeof state>>;
  try {
    await service().processPendingIntents();
    original = await state(fixture.agreementId);
    const tx = await chainClient.getTransaction({ hash: original.transactionHash as `0x${string}` });
    const hash = await external.writeContract({ address: registryAddress!, abi: agreementRegistryAbi, functionName: "registerAgreement", args: [fixture.typedData.message, await buyer.signTypedData(fixture.typedData), await supplier.signTypedData(fixture.typedData)], gas: 300_000n, gasPrice: tx.gasPrice! * 2n });
    await mine();
    assert.equal((await chainClient.getTransactionReceipt({ hash })).status, "success");
    assert.equal((await chainClient.getTransactionReceipt({ hash: original.transactionHash as `0x${string}` })).status, "reverted");
  } finally { await hardhatRpc("evm_setAutomine", [true]); }
  await service(chainClient, prisma, chainId, 3).processPendingIntents();
  assert.equal((await state(fixture.agreementId)).status, "SUBMITTED");
  await mine(); await mine();
  await service(chainClient, prisma, chainId, 3).processPendingIntents();
  const reconciled = await durableState(fixture.agreementId);
  assert.equal(reconciled.intent.status, "RECONCILIATION_REQUIRED");
  assert.equal(reconciled.intent.lastError, "reverted_with_registration");
  assert.equal(reconciled.agreement.status, "ANCHOR_PENDING");
  assert.equal(reconciled.intent.transactionHash, original!.transactionHash);
  assert.equal(reconciled.intent.relayerNonce, original!.relayerNonce);
  assert.ok(reconciled.intent.signedTransaction === original!.signedTransaction, "conflicting registration preserves original signed bytes");
});

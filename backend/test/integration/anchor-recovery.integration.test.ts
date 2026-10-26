import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { createPublicClient, createWalletClient, defineChain, http, keccak256, stringToHex, type Address, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AgreementAnchoringService } from "../../src/blockchain/agreement-anchoring.service.js";
import { AgreementSigningService } from "../../src/agreements/agreement-signing.service.js";
import { agreementApprovalTypedData, canonicalizeAgreementSnapshot } from "../../src/blockchain/agreement-hash.service.js";
import { agreementRegistryAbi } from "../../src/blockchain/agreement-registry.abi.js";

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

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const chain = defineChain({ id: chainId, name: "SLA-DEX local EVM", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
const chainClient = createPublicClient({ chain, transport: http(rpcUrl) });
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

function service(client: PublicClient = chainClient, database: PrismaClient = prisma, contextChainId = chainId) {
  const blockchain = {
    isAnchorConfigured: () => true,
    getSigningContext: async () => {
      const actualChainId = await client.getChainId();
      if (actualChainId !== contextChainId) throw new Error("configured blockchain RPC returned an unexpected chain ID");
      return { client, chainId: contextChainId, registryAddress: registryAddress!, rpcUrl };
    },
    getRelayerAccount: () => relayer,
    getConfirmationCount: () => 1
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

after(async () => {
  for (const fixture of fixtures) {
    await prisma.anchorIntent.deleteMany({ where: { snapshot: { agreementId: fixture.agreementId } } });
    await prisma.signingSnapshot.deleteMany({ where: { agreementId: fixture.agreementId } });
    await prisma.agreement.deleteMany({ where: { id: fixture.agreementId } });
    await prisma.organization.deleteMany({ where: { id: { in: fixture.organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: fixture.userIds } } });
  }
  await prisma.$disconnect();
});

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
  assert.equal((await state(fixture.agreementId)).status, "CONFIRMED");
});

test("R09 dropped transactions rebroadcast identical bytes while replacements stay separate", async () => {
  const dropped = await createFixture();
  const rejectBeforeSend = controlledClient({ sendRawTransaction: (async () => { throw new Error("invalid sender"); }) as never });
  await service(rejectBeforeSend).processPendingIntents();
  const stored = await state(dropped.agreementId);
  await prisma.anchorIntent.update({ where: { id: stored.id }, data: { status: "SUBMISSION_UNCERTAIN", lastError: null } });
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

test("R10 an expected registry record is confirmed without a duplicate transaction", async () => {
  const fixture = await createFixture();
  const before = await chainClient.getTransactionCount({ address: relayer.address });
  await relayerWallet.writeContract({ address: registryAddress!, abi: agreementRegistryAbi, functionName: "registerAgreement", args: [fixture.typedData.message, (await buyer.signTypedData(fixture.typedData)), (await supplier.signTypedData(fixture.typedData))] });
  await service().processPendingIntents();
  const intent = await state(fixture.agreementId);
  assert.equal(intent.status, "CONFIRMED");
  assert.equal(intent.transactionHash, null);
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
  await prisma.anchorIntent.update({ where: { id: intent.id }, data: { status: "SUBMISSION_UNCERTAIN", lastError: null } });
  await service().processPendingIntents();
  const rebroadcast = await state(fixture.agreementId);
  assert.equal(rebroadcast.status, "SUBMITTED");
  assert.equal(rebroadcast.transactionHash, intent.transactionHash);
  await service().processPendingIntents();
  assert.equal((await state(fixture.agreementId)).status, "CONFIRMED");
});

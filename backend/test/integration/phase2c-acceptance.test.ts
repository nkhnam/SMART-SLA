import "reflect-metadata";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { NestFactory } from "@nestjs/core";
import { createPublicClient, defineChain, encodeAbiParameters, http, keccak256, stringToHex, type Hex, type TypedDataDefinition } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AppModule } from "../../dist/app.module.js";
import { configureApplication } from "../../dist/config/configure-app.js";
import { PrismaService } from "../../dist/database/prisma.service.js";
import { AgreementAnchoringService } from "../../dist/blockchain/agreement-anchoring.service.js";
import { agreementRegistryAbi } from "../../dist/blockchain/agreement-registry.abi.js";
import { EvidenceAnchorWorkerService } from "../../dist/monitoring/evidence-anchor-worker.service.js";
import { evidenceRegistryAbi } from "../../dist/monitoring/evidence-registry.abi.js";
import { MonitoringWorkerService } from "../../dist/monitoring/monitoring-worker.service.js";
import { MonitoringRetentionService } from "../../dist/monitoring/monitoring-retention.service.js";
import { buildMerkleEntries } from "../../dist/monitoring/evidence-protocol.js";
import { runPublicHttpsAcceptance } from "./public-https.live.ts";

type Actor = { cookie: string; organizationId: string };
type Source = { id: string; createdAt: string; trustCategory: string; webhookSecret: string };
type Package = {
  manifest: { merkleRoot: Hex; batchDigest: Hex; schemaVersion: string; agreementId: string; agreementVersion: number; signingSnapshotHash: Hex; windowStart: string; windowEnd: string };
  records: Array<{ index: number; record: { id: string; agreementVersion: number; reachable: boolean; source: { name: string }; trustCategory: string }; leafDigest: Hex; inclusionProof: Hex[] }>;
  anchor: { status: string; transactionHash: Hex };
  verification: { valid: boolean; recordsVerified: number };
};

const publicHttps = process.env.PHASE2C_PUBLIC_HTTPS === "1";
test(publicHttps ? "real public HTTPS observations persist, evaluate, export and verify without a transport override" : "synthetic provider reports persist, breach, commit, verify, reject tampering and remain version-scoped", { timeout: publicHttps ? 240_000 : 120_000 }, async (t) => {
  assert.equal(process.env.NODE_ENV, "test");
  assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/phase2c_[a-f0-9]{32}_test$/);
  const rpcUrl = new URL(process.env.BLOCKCHAIN_RPC_URL!);
  assert.equal(rpcUrl.hostname, "127.0.0.1");
  assert.equal(process.env.EVIDENCE_RPC_URL, rpcUrl.toString().replace(/\/$/, ""));
  const output = process.env.PHASE2C_ACCEPTANCE_OUTPUT!;
  assert.ok(output);
  const chain = defineChain({ id: 31337, name: "Phase 2C acceptance read-back", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl.toString()] } } });
  const reader = createPublicClient({ chain, transport: http(rpcUrl.toString()), cacheTime: 0 });
  assert.equal(await reader.getChainId(), 31337);
  const app = await NestFactory.create(AppModule, { logger: ["error"], rawBody: true });
  configureApplication(app);
  let stage = "application startup";
  try {
    await app.listen(0, "127.0.0.1");
    const port = app.getHttpServer().address().port;
    const base = `http://127.0.0.1:${port}/api/v1`;
    const prisma = app.get(PrismaService);
    const agreementWorker = app.get(AgreementAnchoringService);
    const evidenceWorker = app.get(EvidenceAnchorWorkerService);
    for (const worker of [agreementWorker, evidenceWorker, app.get(MonitoringWorkerService), app.get(MonitoringRetentionService)]) worker.onModuleDestroy();
    const origin = "http://localhost:3000";
    async function step(name: string, run: () => Promise<void>) {
      let failure: unknown;
      await t.test(name, async () => {
        try { await run(); } catch (error) { failure = error; throw error; }
      });
      if (failure) throw failure;
    }
    async function api<T>(actor: Actor | undefined, path: string, method = "GET", body?: unknown, expected = method === "POST" ? 201 : 200): Promise<T> {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { origin, "x-sla-csrf": "1", "content-type": "application/json", ...(actor ? { cookie: actor.cookie, "x-organization-id": actor.organizationId } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10_000)
      });
      assert.equal(response.status, expected, `${method} ${path} status`);
      return await response.json() as T;
    }
    async function register(role: "CUSTOMER" | "PROVIDER"): Promise<Actor> {
      const response = await fetch(`${base}/auth/register`, { method: "POST", headers: { origin, "x-sla-csrf": "1", "content-type": "application/json" }, body: JSON.stringify({ email: `${role.toLowerCase()}@acceptance.example.test`, password: "Acceptance-Only-Password-92!", displayName: `Synthetic ${role}`, organizationName: `Synthetic acceptance ${role}`, organizationType: role }) });
      assert.equal(response.status, 201);
      const payload = await response.json() as { organization: { id: string } };
      const cookie = response.headers.getSetCookie()[0]?.split(";", 1)[0];
      assert.ok(cookie);
      const actor = { cookie, organizationId: payload.organization.id };
      await api(actor, "/auth/me");
      return actor;
    }
    const customer = await register("CUSTOMER");
    const provider = await register("PROVIDER");
    const terms = { name: publicHttps ? "Real public HTTPS acceptance SLA" : "Synthetic acceptance SLA", serviceDescription: publicHttps ? "Real operator HTTP probes in an isolated acceptance environment; not an independent oracle" : "Controlled provider-reported healthy/outage/recovery fixture; not independent measurement", counterpartyDisplayName: "Synthetic Provider", terms: { uptimeTargetPercent: 99, responseTimeTargetMs: 200, measurementWindowHours: 1, exclusions: [] } };
    const agreement = await api<{ id: string }>(customer, "/agreements", "POST", terms);
    const path = `/agreements/${agreement.id}`;
    const monitoring = `${path}/monitoring`;
    let agreementTransaction: Hex;
    let snapshotHash: Hex;

    await step("authenticated invitation, wallet proofs and bilateral signatures confirm the real agreement registry", async () => {
      stage = "agreement signing and anchoring";
      await api(provider, path, "GET", undefined, 404);
      await api(customer, `${monitoring}/sources`, "POST", { type: "SIGNED_WEBHOOK", name: "too early", intervalSeconds: 300 }, 409);
      const invitation = await api<{ id: string }>(customer, `${path}/invitations`, "POST", { organizationId: provider.organizationId });
      await api(provider, `${path}/invitations/${invitation.id}/accept`, "POST");
      assert.equal((await api<{ status: string }>(customer, path)).status, "AWAITING_SIGNATURES");
      for (const [actor, key] of [[customer, `0x${"11".repeat(32)}`], [provider, `0x${"22".repeat(32)}`]] as const) {
        const account = privateKeyToAccount(key as Hex);
        const challenge = await api<{ challengeId: string; typedData: TypedDataDefinition }>(actor, "/organizations/signers/challenge", "POST", { address: account.address });
        const signature = await account.signTypedData(challenge.typedData);
        const signer = await api<{ id: string }>(actor, "/organizations/signers/verify", "POST", { challengeId: challenge.challengeId, signature });
        await api(actor, `${path}/signers`, "POST", { authorizedSignerId: signer.id });
      }
      const snapshot = await api<{ typedData: TypedDataDefinition; snapshotHash: Hex }>(customer, `${path}/signing/prepare`, "POST");
      snapshotHash = snapshot.snapshotHash;
      for (const [actor, key] of [[customer, `0x${"11".repeat(32)}`], [provider, `0x${"22".repeat(32)}`]] as const) {
        const signature = await privateKeyToAccount(key as Hex).signTypedData(snapshot.typedData);
        await api(actor, `${path}/signatures`, "POST", { signature });
      }
      await agreementWorker.processPendingIntents();
      await agreementWorker.processPendingIntents();
      const anchor = await api<{ agreementStatus: string; blockchainStatus: string; anchor: { transactionHash: Hex; lastError: string | null } }>(customer, `${path}/anchor`);
      assert.equal(anchor.agreementStatus, "ANCHOR_CONFIRMED", `Agreement worker state ${anchor.blockchainStatus}; reason ${anchor.anchor?.lastError ?? "none"}`);
      assert.equal(anchor.blockchainStatus, "CONFIRMED");
      agreementTransaction = anchor.anchor.transactionHash;
      assert.equal((await reader.getTransactionReceipt({ hash: agreementTransaction })).status, "success");
      const stored = await prisma.signingSnapshot.findUniqueOrThrow({ where: { agreementId_version: { agreementId: agreement.id, version: 1 } }, include: { signatures: true } });
      assert.equal(stored.signatures.length, 2);
      snapshotHash = stored.snapshotHash;
      const record = await reader.readContract({ address: process.env.BLOCKCHAIN_REGISTRY_ADDRESS as Hex, abi: agreementRegistryAbi, functionName: "getAgreement", args: [stored.agreementKey as Hex] });
      assert.equal(record.agreementHash, snapshotHash);
      assert.equal(record.version, 1n);
      assert.ok(record.registeredAt > 0n);
    });
    if (publicHttps) {
      stage = "real public HTTPS acceptance";
      await runPublicHttpsAcceptance({ app, api, customer, provider, path, monitoring, output, reader, snapshotHash: snapshotHash!, agreementTransaction: agreementTransaction!, terms });
      return;
    }
    const source = await api<Source>(provider, `${monitoring}/sources`, "POST", { type: "SIGNED_WEBHOOK", name: "SYNTHETIC acceptance fixture: healthy -> outage -> recovery", intervalSeconds: 300 });
    assert.equal(source.trustCategory, "PROVIDER_REPORTED");
    const start = new Date(source.createdAt);
    const end = new Date(start.getTime() + 3_600_000);
    t.mock.timers.enable({ apis: ["Date"], now: start });
    const samples: boolean[] = [...Array(4).fill(true), ...Array(4).fill(false), ...Array(4).fill(true)];
    async function webhook(slot: number, signatureOverride?: string, expected = 201) {
      const observedAt = new Date(start.getTime() + slot * 300_000);
      const phase = slot <= 4 ? "healthy" : slot <= 8 ? "outage" : "recovery";
      const body = JSON.stringify({ observedAt: observedAt.toISOString(), reachable: samples[slot - 1] ?? true, httpStatus: samples[slot - 1] === false ? 503 : 200, ...(samples[slot - 1] === false ? {} : { latencyMs: 100 }), agentIdentity: "synthetic-acceptance-fixture", providerMetadata: { synthetic: true, phase, independentMeasurement: false } });
      const timestamp = String(Math.floor(observedAt.getTime() / 1000));
      const nonce = `acceptance-nonce-${slot.toString().padStart(4, "0")}`;
      const eventId = `synthetic-${slot}`;
      const signature = `v1=${createHmac("sha256", source.webhookSecret).update(`${timestamp}.${nonce}.${eventId}.`).update(body).digest("hex")}`;
      const response = await fetch(`${base}/monitoring/webhooks/${source.id}`, { method: "POST", headers: { "content-type": "application/json", "x-monitoring-timestamp": timestamp, "x-monitoring-nonce": nonce, "x-monitoring-event-id": eventId, "x-monitoring-signature": signatureOverride ?? signature }, body, signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, expected, `Synthetic webhook slot ${slot}`);
      return response.json();
    }

    await step("authorized synthetic webhook sequence persists twelve observations without bypassing security", async () => {
      stage = "synthetic webhook ingestion";
      t.mock.timers.setTime(start.getTime() + 300_000);
      await webhook(1, `v1=${"00".repeat(32)}`, 403);
      assert.equal(await prisma.monitoringObservation.count(), 0);
      for (let slot = 1; slot <= 12; slot += 1) {
        t.mock.timers.setTime(start.getTime() + slot * 300_000);
        await webhook(slot);
      }
      const duplicate = await webhook(12) as { duplicate: boolean };
      assert.equal(duplicate.duplicate, true);
      const rows = await prisma.monitoringObservation.findMany({ where: { sourceId: source.id }, orderBy: { observedAt: "asc" } });
      assert.equal(rows.length, 12);
      assert.deepEqual(rows.map((row) => row.reachable), samples);
      assert.ok(rows.every((row) => row.agreementId === agreement.id && row.agreementVersion === 1 && row.trustCategory === "PROVIDER_REPORTED" && row.agentIdentity === "synthetic-acceptance-fixture"));
      assert.ok(rows.every((row) => row.rawMetadata.providerMetadata.synthetic === true && row.rawMetadata.providerMetadata.independentMeasurement === false));
    });
    const window = { windowStart: start.toISOString(), windowEnd: end.toISOString() };
    await step("coverage and KPIs persist one deterministic non-adjudicative breach candidate", async () => {
      stage = "KPI evaluation";
      const result = await api<{ data: Array<{ id: string }> }>(customer, `${monitoring}/kpis/evaluate`, "POST", { ...window, sourceId: source.id });
      const repeated = await api<{ data: Array<{ id: string }> }>(customer, `${monitoring}/kpis/evaluate`, "POST", { ...window, sourceId: source.id });
      assert.equal(repeated.data[0]?.id, result.data[0]?.id);
      const evaluation = await prisma.kpiEvaluation.findUniqueOrThrow({ where: { id: result.data[0]!.id }, include: { breachCandidate: true } });
      assert.equal(evaluation.agreementVersion, 1);
      assert.equal(evaluation.expectedSamples, 12);
      assert.equal(evaluation.healthyObservations, 8);
      assert.equal(evaluation.failedObservations, 4);
      assert.equal(evaluation.unknownObservations, 0);
      assert.equal(Number(evaluation.coveragePercent), 100);
      assert.equal(Number(evaluation.uptimePercent), 66.67);
      assert.equal(Number(evaluation.meanLatencyMs), 100);
      assert.equal(evaluation.state, "BREACH_CANDIDATE");
      assert.equal(evaluation.breachCandidate?.state, "BREACH_CANDIDATE");
      assert.equal(await prisma.breachCandidate.count(), 1);
    });
    let exported: Package;
    let commitment: unknown;
    let batchId: string;
    let batchKey: Hex;
    await step("evidence is deterministic and the real publisher commitment matches independent local EVM read-back", async () => {
      stage = "evidence publication and read-back";
      const batch = await api<{ id: string; merkleRoot: Hex; batchDigest: Hex }>(customer, `${monitoring}/evidence`, "POST", window);
      batchId = batch.id;
      const repeated = await api<{ id: string; merkleRoot: Hex; batchDigest: Hex }>(customer, `${monitoring}/evidence`, "POST", window);
      assert.equal(repeated.id, batch.id);
      assert.equal(repeated.merkleRoot, batch.merkleRoot);
      assert.equal(repeated.batchDigest, batch.batchDigest);
      await evidenceWorker.processPending();
      await evidenceWorker.processPending();
      exported = await api<Package>(customer, `${monitoring}/evidence/${batch.id}`);
      assert.equal(exported.anchor.status, "CONFIRMED");
      assert.equal(exported.verification.valid, true);
      assert.equal(exported.records.length, 12);
      assert.equal(exported.manifest.signingSnapshotHash, snapshotHash);
      assert.ok(exported.records.every((entry) => entry.record.agreementVersion === 1 && entry.record.trustCategory === "PROVIDER_REPORTED" && entry.record.source.name.startsWith("SYNTHETIC")));
      const reconstructed = buildMerkleEntries(exported.records.map((entry) => entry.record));
      assert.equal(reconstructed.root, exported.manifest.merkleRoot);
      assert.deepEqual(reconstructed.entries.map((entry) => entry.proof), exported.records.map((entry) => entry.inclusionProof));
      const intent = await prisma.evidenceAnchorIntent.findUniqueOrThrow({ where: { batchId: batch.id } });
      assert.equal(intent.status, "CONFIRMED");
      assert.equal(intent.transactionChainId, 31337);
      assert.notEqual(intent.relayerAddress.toLowerCase(), privateKeyToAccount(process.env.BLOCKCHAIN_RELAYER_PRIVATE_KEY as Hex).address.toLowerCase());
      const receipt = await reader.getTransactionReceipt({ hash: exported.anchor.transactionHash });
      assert.equal(receipt.status, "success");
      batchKey = intent.anchorKey as Hex;
      commitment = await reader.readContract({ address: process.env.EVIDENCE_REGISTRY_ADDRESS as Hex, abi: evidenceRegistryAbi, functionName: "getCommitment", args: [batchKey] });
      const expectedVersionKey = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint64" }], [keccak256(stringToHex(agreement.id)), 1n]));
      assert.deepEqual(commitment, { agreementVersionKey: expectedVersionKey, merkleRoot: exported.manifest.merkleRoot, batchDigest: exported.manifest.batchDigest, schemaVersionHash: keccak256(stringToHex(exported.manifest.schemaVersion)), agreementVersion: 1n, windowStart: BigInt(Math.floor(start.getTime() / 1000)), windowEnd: BigInt(Math.floor(end.getTime() / 1000)), reporter: privateKeyToAccount(process.env.EVIDENCE_RELAYER_PRIVATE_KEY as Hex).address, committedAt: (await reader.getBlock({ blockNumber: receipt.blockNumber })).timestamp });
    });

    await step("the existing standalone CLI accepts the untouched export and rejects one mutated observation", async () => {
      stage = "standalone verification and tamper rejection";
      const originalPath = join(output, "evidence.json");
      const originalBytes = JSON.stringify(exported!);
      await writeFile(originalPath, originalBytes);
      const tampered = structuredClone(exported!);
      tampered.records[0]!.record.reachable = !tampered.records[0]!.record.reachable;
      const tamperedPath = join(output, "evidence-tampered.json");
      await writeFile(tamperedPath, JSON.stringify(tampered));
      for (const [file, expectedExit, valid] of [[originalPath, 0, true], [tamperedPath, 1, false]] as const) {
        const result = spawnSync(process.execPath, [process.env.npm_execpath!, "run", "verify:evidence", "--", file], { encoding: "utf8", timeout: 30_000, windowsHide: true });
        assert.equal(result.status, expectedExit);
        const verdict = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
        assert.equal(verdict.valid, valid);
        assert.equal(verdict.recordCount, 12);
        await writeFile(join(output, valid ? "verifier-original.json" : "verifier-tampered.json"), JSON.stringify({ exitCode: result.status, ...verdict }));
      }
      assert.equal(await readFile(originalPath, "utf8"), originalBytes);
      assert.deepEqual(await reader.readContract({ address: process.env.EVIDENCE_REGISTRY_ADDRESS as Hex, abi: evidenceRegistryAbi, functionName: "getCommitment", args: [batchKey!] }), commitment!);
    });

    await step("amendment blocks old-source ingestion and preserves immutable version-one PostgreSQL evidence", async () => {
      stage = "agreement version isolation";
      await api(customer, `${path}/amend`, "POST", { ...terms, expectedVersion: 1, name: "Synthetic acceptance SLA v2" });
      assert.equal((await api<{ version: number }>(customer, path)).version, 2);
      t.mock.timers.setTime(start.getTime() + 13 * 300_000);
      await webhook(13, undefined, 409);
      await api(customer, `${monitoring}/sources`, "POST", { type: "SIGNED_WEBHOOK", name: "unsigned v2", intervalSeconds: 300 }, 409);
      const row = await prisma.monitoringObservation.findFirstOrThrow({ where: { sourceId: source.id } });
      const mismatched = { ...row };
      delete mismatched.id;
      await assert.rejects(prisma.monitoringObservation.create({ data: { ...mismatched, agreementVersion: 2, idempotencyKey: "wrong-version", webhookNonce: "wrong-version-nonce" } }), (error: { code?: string }) => error.code === "P2003");
      assert.equal(await prisma.monitoringObservation.count({ where: { agreementId: agreement.id, agreementVersion: 1 } }), 12);
      assert.equal(await prisma.monitoringObservation.count({ where: { agreementId: agreement.id, agreementVersion: 2 } }), 0);
      assert.equal(await prisma.evidenceBatch.count({ where: { agreementId: agreement.id, agreementVersion: 1 } }), 1);
      assert.equal(await prisma.evidenceRecord.count({ where: { batchId: batchId! } }), 12);
      const historical = await api<Package>(customer, `${monitoring}/evidence/${batchId!}`);
      assert.deepEqual(historical, exported!);
    });
    await writeFile(join(output, "summary.json"), JSON.stringify({ chainId: 31337, agreementId: agreement.id, agreementVersion: 1, agreementRegistry: process.env.BLOCKCHAIN_REGISTRY_ADDRESS, agreementTransaction: agreementTransaction!, evidenceRegistry: process.env.EVIDENCE_REGISTRY_ADDRESS, evidenceTransaction: exported!.anchor.transactionHash, batchKey: batchKey!, merkleRoot: exported!.manifest.merkleRoot, batchDigest: exported!.manifest.batchDigest, observationCount: 12, expectedSamples: 12, healthy: 8, failed: 4, unknown: 0, coveragePercent: 100, uptimePercent: 66.67, meanLatencyMs: 100, state: "BREACH_CANDIDATE", synthetic: true, trustCategory: "PROVIDER_REPORTED", independentMeasurement: false, originalVerifierExit: 0, tamperedVerifierExit: 1, commitmentUnchanged: true, versionIsolation: true }, null, 2));
  } catch (error) {
    await writeFile(join(output, "failure.json"), JSON.stringify({ stage, errorType: error instanceof Error ? error.name : "unknown" }));
    throw error;
  } finally {
    t.mock.timers.reset();
    await app.close();
  }
});

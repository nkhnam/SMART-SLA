import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { INestApplication } from "@nestjs/common";
import { encodeAbiParameters, keccak256, stringToHex, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PrismaService } from "../../dist/database/prisma.service.js";
import { MonitoringWorkerService } from "../../dist/monitoring/monitoring-worker.service.js";
import { EvidenceAnchorWorkerService } from "../../dist/monitoring/evidence-anchor-worker.service.js";
import { evidenceRegistryAbi } from "../../dist/monitoring/evidence-registry.abi.js";
import { resolvePublicAddress, validateEndpointUrl } from "../../dist/monitoring/ssrf.js";

type Actor = { cookie: string; organizationId: string };
type Api = <T>(actor: Actor | undefined, path: string, method?: string, body?: unknown, expected?: number) => Promise<T>;
type Source = { id: string; createdAt: string; trustCategory: string };
type Export = {
  manifest: { merkleRoot: Hex; batchDigest: Hex; schemaVersion: string; signingSnapshotHash: Hex };
  records: Array<{ record: { id: string; reachable: boolean | null; method: string; trustCategory: string; agreementVersion: number } }>;
  anchor: { status: string; transactionHash: Hex };
  verification: { valid: boolean };
};

export async function runPublicHttpsAcceptance(options: {
  app: INestApplication; api: Api; customer: Actor; provider: Actor; path: string; monitoring: string; output: string;
  reader: Pick<PublicClient, "getTransactionReceipt" | "readContract" | "getBlock">;
  snapshotHash: Hex; agreementTransaction: Hex; terms: object;
}) {
  const { app, api, customer, provider, path, monitoring, output, reader } = options;
  const prisma = app.get(PrismaService);
  const worker = app.get(MonitoringWorkerService);
  const agreementId = path.split("/").at(-1)!;
  const healthyUrl = process.env.LIVE_HTTPS_URL ?? "https://example.com/";
  const failureUrl = process.env.LIVE_HTTPS_FAILURE_URL ?? (process.env.LIVE_HTTPS_URL ? undefined : "https://example.com/sladex-gate3d-missing");
  const targets = [{ name: "healthy", url: healthyUrl }, ...(failureUrl ? [{ name: "http-failure", url: failureUrl }] : [])];
  const sources: Array<Source & { name: string; endpoint: string; dns: unknown }> = [];
  for (const target of targets) {
    const url = validateEndpointUrl(target.url);
    assert.equal(url.protocol, "https:", "Live acceptance requires HTTPS");
    assert.equal(url.search, "", "Use public URLs without query credentials");
    let dns: unknown;
    try { dns = { available: true, ...await resolvePublicAddress(url) }; }
    catch (error) { dns = { available: false, errorType: error instanceof Error ? error.name : "unknown", code: (error as NodeJS.ErrnoException).code ?? null }; }
    const input = { type: "HTTP_PROBE", name: `REAL HTTPS acceptance: ${target.name}`, endpointUrl: url.href, intervalSeconds: 60 };
    await api(undefined, `${monitoring}/sources`, "POST", input, 401);
    const source = await api<Source>(provider, `${monitoring}/sources`, "POST", input);
    assert.equal(source.trustCategory, "SYNTHETIC_TEST");
    await api(customer, `${monitoring}/sources/${source.id}`, "PATCH", { enabled: false }, 404);
    sources.push({ ...source, name: target.name, endpoint: url.href, dns });
  }

  await worker.processDueSources();
  const observations = await prisma.monitoringObservation.findMany({ where: { agreementId }, orderBy: { observedAt: "asc" } });
  const runs = await prisma.monitoringRun.findMany({ where: { sourceId: { in: sources.map((source) => source.id) } } });
  const results = sources.map((source) => {
    const row = observations.find((observation) => observation.sourceId === source.id);
    const state = !row ? "MISSING" : row.errorCategory === "HTTP" ? "HTTP_FAILURE" : row.reachable && row.validity === "VALID" ? "OBSERVED_HEALTHY" : "UNAVAILABLE_FROM_OBSERVER";
    return { ...source, state, observation: row ?? null, run: runs.find((run) => run.sourceId === source.id) ?? null };
  });
  await writeFile(join(output, "network-observations.json"), JSON.stringify({ collectedAt: new Date(), realNetwork: true, syntheticObservations: false, independentMeasurement: false, outage: "NOT_ESTABLISHED", results }, null, 2));
  console.log(JSON.stringify({ stage: "real HTTPS collection", results: results.map((result) => ({ endpoint: result.endpoint, state: result.state, errorCategory: result.observation?.errorCategory })), waitingFor: "one uncollected schedule slot" }));
  assert.equal(observations.length, sources.length, "Each real probe must persist exactly one observation; see network-observations.json");
  for (const row of observations) {
    assert.equal(row.method, "HTTP_PROBE");
    assert.equal(row.trustCategory, "SYNTHETIC_TEST");
    assert.equal(row.agreementVersion, 1);
    assert.equal(row.provenance.collectionMethod, "operator_http_probe");
    assert.deepEqual(row.rawMetadata, { responseBodyStored: false });
    assert.equal(runs.find((run) => run.id === row.runId)?.status, "COMPLETED");
  }

  const nextSlot = Math.max(...sources.map((source) => Date.parse(source.createdAt))) + 60_001;
  while (Date.now() < nextSlot) await delay(Math.min(1000, nextSlot - Date.now()));
  const end = new Date();
  const start = new Date(end.getTime() - 3_600_000);
  const window = { windowStart: start.toISOString(), windowEnd: end.toISOString() };
  const evaluations = await api<{ data: Array<{ id: string }> }>(customer, `${monitoring}/kpis/evaluate`, "POST", window);
  const stored = await prisma.kpiEvaluation.findMany({ where: { id: { in: evaluations.data.map((item) => item.id) } } });
  assert.equal(stored.length, sources.length);
  for (const evaluation of stored) {
    const observation = observations.find((row) => row.sourceId === evaluation.sourceId)!;
    const valid = observation.validity === "VALID" && observation.reachable !== null;
    assert.ok(evaluation.expectedSamples >= 2);
    assert.equal(evaluation.healthyObservations, valid && observation.reachable === true ? 1 : 0);
    assert.equal(evaluation.failedObservations, valid && observation.reachable === false ? 1 : 0);
    assert.equal(evaluation.unknownObservations, evaluation.expectedSamples - (valid ? 1 : 0));
    assert.equal(Number(evaluation.coveragePercent), Math.round((valid ? 100 : 0) / evaluation.expectedSamples * 100) / 100);
    assert.ok(evaluation.unknownObservations >= 1);
    assert.equal(evaluation.uptimePercent, null);
    assert.equal(evaluation.state, "INSUFFICIENT_DATA");
  }
  assert.equal(await prisma.breachCandidate.count({ where: { agreementId } }), 0);
  const batch = await api<{ id: string }>(customer, `${monitoring}/evidence`, "POST", window);
  const publisher = app.get(EvidenceAnchorWorkerService);
  await publisher.processPending();
  await publisher.processPending();
  const exported = await api<Export>(customer, `${monitoring}/evidence/${batch.id}`);
  assert.equal(exported.anchor.status, "CONFIRMED");
  assert.equal(exported.verification.valid, true);
  assert.equal(exported.manifest.signingSnapshotHash, options.snapshotHash);
  assert.deepEqual(exported.records.map((entry) => entry.record.id).sort(), observations.map((row) => row.id).sort());
  assert.ok(exported.records.every((entry) => entry.record.method === "HTTP_PROBE" && entry.record.trustCategory === "SYNTHETIC_TEST" && entry.record.agreementVersion === 1));
  const intent = await prisma.evidenceAnchorIntent.findUniqueOrThrow({ where: { batchId: batch.id } });
  const receipt = await reader.getTransactionReceipt({ hash: exported.anchor.transactionHash });
  assert.equal(receipt.status, "success");
  const commitment = await reader.readContract({ address: process.env.EVIDENCE_REGISTRY_ADDRESS as Hex, abi: evidenceRegistryAbi, functionName: "getCommitment", args: [intent.anchorKey as Hex] });
  assert.deepEqual(commitment, {
    agreementVersionKey: keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint64" }], [keccak256(stringToHex(agreementId)), 1n])),
    merkleRoot: exported.manifest.merkleRoot, batchDigest: exported.manifest.batchDigest,
    schemaVersionHash: keccak256(stringToHex(exported.manifest.schemaVersion)), agreementVersion: 1n,
    windowStart: BigInt(Math.floor(start.getTime() / 1000)), windowEnd: BigInt(Math.floor(end.getTime() / 1000)),
    reporter: privateKeyToAccount(process.env.EVIDENCE_RELAYER_PRIVATE_KEY as Hex).address,
    committedAt: (await reader.getBlock({ blockNumber: receipt.blockNumber })).timestamp
  });
  const original = JSON.stringify(exported);
  await writeFile(join(output, "evidence.json"), original);
  const tampered = structuredClone(exported);
  tampered.records[0]!.record.reachable = !tampered.records[0]!.record.reachable;
  await writeFile(join(output, "evidence-tampered.json"), JSON.stringify(tampered));
  for (const [file, expectedExit, valid] of [["evidence.json", 0, true], ["evidence-tampered.json", 1, false]] as const) {
    const result = spawnSync(process.execPath, [process.env.npm_execpath!, "run", "verify:evidence", "--", join(output, file)], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    assert.equal(result.status, expectedExit);
    const verdict = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
    assert.equal(verdict.valid, valid);
    await writeFile(join(output, valid ? "verifier-original.json" : "verifier-tampered.json"), JSON.stringify({ exitCode: result.status, ...verdict }));
  }
  await api(customer, `${path}/amend`, "POST", { ...options.terms, expectedVersion: 1, name: "Real HTTPS acceptance SLA v2" });
  for (const source of sources) {
    await api(provider, `${monitoring}/sources/${source.id}`, "PATCH", { enabled: true }, 404);
    await api(customer, `${monitoring}/sources/${source.id}`, "PATCH", { enabled: true }, 409);
  }
  await api(customer, `${monitoring}/sources`, "POST", { type: "HTTP_PROBE", name: "unsigned v2", endpointUrl: healthyUrl, intervalSeconds: 60 }, 409);
  await worker.processDueSources();
  assert.equal(await prisma.monitoringObservation.count({ where: { agreementId, agreementVersion: 2 } }), 0);
  assert.equal(await prisma.monitoringObservation.count({ where: { agreementId, agreementVersion: 1 } }), observations.length);
  assert.ok((await prisma.monitoringSource.findMany({ where: { agreementId } })).every((source) => !source.enabled));
  assert.deepEqual(await api(customer, `${monitoring}/evidence/${batch.id}`), exported);
  assert.equal(await readFile(join(output, "evidence.json"), "utf8"), original);
  const healthyObserved = results.find((result) => result.name === "healthy")?.state === "OBSERVED_HEALTHY";
  const httpFailureObserved = results.find((result) => result.name === "http-failure")?.state === "HTTP_FAILURE";
  await writeFile(join(output, "summary.json"), JSON.stringify({
    gate: "3D", accepted: healthyObserved && (!failureUrl || httpFailureObserved), realNetwork: true, syntheticObservations: false,
    trustCategory: "SYNTHETIC_TEST", independentMeasurement: false, outage: "NOT_ESTABLISHED", healthyObserved, httpFailureObserved: failureUrl ? httpFailureObserved : "NOT_REQUESTED",
    results: results.map(({ observation, ...result }) => ({ ...result, observationId: observation?.id, errorCategory: observation?.errorCategory })),
    window, windowScope: "bootstrap slots since source creation, not one hour of collection", evaluations: stored,
    chainId: 31337, agreementId, agreementVersion: 1, agreementTransaction: options.agreementTransaction,
    evidenceRegistry: process.env.EVIDENCE_REGISTRY_ADDRESS, evidenceTransaction: exported.anchor.transactionHash,
    batchKey: intent.anchorKey, merkleRoot: exported.manifest.merkleRoot, batchDigest: exported.manifest.batchDigest,
    independentCommitmentReadback: true, originalVerifierExit: 0, tamperedVerifierExit: 1, versionIsolation: true
  }, null, 2));
  assert.ok(healthyObserved, "No healthy public HTTPS response was observed; network diagnostics and real failure evidence were retained, not an outage verdict");
  if (failureUrl) assert.ok(httpFailureObserved, "Expected an actual HTTP error reply from LIVE_HTTPS_FAILURE_URL; inspect network-observations.json");
}

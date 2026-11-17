import assert from "node:assert/strict";
import { test } from "node:test";
import { MonitoringKpiService } from "../../src/monitoring/monitoring-kpi.service.js";
import { MonitoringEvidenceService } from "../../src/monitoring/monitoring-evidence.service.js";

const start = new Date("2026-01-01T00:00:00.123Z");
const end = new Date(start.getTime() + 3_600_000);
const context = { user: { id: "user" }, organization: { id: "organization", role: "OWNER" } };

for (const frozenState of ["INSUFFICIENT_DATA", "BREACH_CANDIDATE"] as const) {
  test("a frozen " + frozenState + " evaluation remains authoritative when late observations would change the result", async () => {
    const frozen = { id: "evaluation", organizationId: "organization", state: frozenState, coveragePercent: 85 };
    const candidates: Array<{ create: { summary: string } }> = [];
    const prisma = {
      agreement: { findUniqueOrThrow: async () => ({ version: 1, ownerOrganizationId: "organization" }) },
      agreementVersion: { findUniqueOrThrow: async () => ({ uptimeTargetPercent: 99, responseTimeTargetMs: 200, measurementWindowHours: 1 }) },
      monitoringSource: { findMany: async () => [{ id: "source", organizationId: "organization", createdAt: start, intervalSeconds: 60 }] },
      monitoringObservation: { findMany: async () => Array.from({ length: 60 }, (_, index) => ({ scheduledFor: new Date(start.getTime() + (index + 1) * 60_000), validity: "VALID", reachable: frozenState === "BREACH_CANDIDATE", latencyMs: 100 })) },
      kpiEvaluation: { upsert: async () => frozen },
      breachCandidate: { upsert: async (input: { create: { summary: string } }) => { candidates.push(input); return {}; } }
    };
    const access = { requireActiveAgreement: async () => ({ agreement: { version: 1 } }) };
    const service = new MonitoringKpiService(prisma as never, access as never);
    assert.deepEqual(await service.evaluate(context as never, "agreement", start.toISOString(), end.toISOString()), { data: [frozen] });
    assert.equal(candidates.length, frozenState === "BREACH_CANDIDATE" ? 1 : 0);
    if (candidates.length) assert.match(candidates[0]!.create.summary, /85% coverage/);
  });
}

test("evidence uses the same exclusive-start, inclusive-end scheduled slots as KPI evaluation, including delayed probes", async () => {
  const observation = (id: string, scheduledFor: Date, observedAt: Date) => ({ id, agreementVersion: 1, sourceId: "source", trustCategory: "OPERATOR_COLLECTED", observedAt, ingestedAt: observedAt,
    scheduledFor, method: "HTTP_PROBE", httpStatus: 200, latencyMs: 100, reachable: true, errorCategory: null, probeDurationMs: 100, collectionRegion: null, agentIdentity: "probe", validity: "VALID", validityReason: null,
    provenance: {}, source: { name: "Public probe", type: "HTTP_PROBE", trustCategory: "OPERATOR_COLLECTED" } });
  const rows = [observation("previous-slot", start, new Date(start.getTime() + 100)),
    observation("earlier-slot-late", new Date(start.getTime() + 60_000), new Date(end.getTime() + 200)),
    observation("closing-slot", end, new Date(end.getTime() + 100))];
  type ObservationQuery = { where: { agreementVersion: number; scheduledFor?: { gt: Date; lte: Date }; observedAt?: { gte: Date; lte: Date } } };
  let created: { agreementVersion: number; records: { create: Array<{ observationId: string }> } } | undefined;
  const prisma = {
    agreement: { findUniqueOrThrow: async () => ({ version: 1 }) },
    monitoringObservation: { findMany: async ({ where }: ObservationQuery) => rows.filter((row) => row.agreementVersion === where.agreementVersion
      && (!where.scheduledFor || (row.scheduledFor > where.scheduledFor.gt && row.scheduledFor <= where.scheduledFor.lte))
      && (!where.observedAt || (row.observedAt >= where.observedAt.gte && row.observedAt <= where.observedAt.lte))) },
    signingSnapshot: { findUniqueOrThrow: async () => ({ snapshotHash: "0x" + "11".repeat(32) }) },
    agreementVersion: { findUniqueOrThrow: async () => ({ measurementWindowHours: 1 }) },
    kpiEvaluation: { findMany: async () => [] },
    evidenceBatch: { findUnique: async () => null, create: async ({ data }: { data: NonNullable<typeof created> }) => { created = data; return { ...data, id: "batch" }; } },
    $executeRaw: async () => 1,
    $transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback(prisma)
  };
  const access = { requireActiveAgreement: async () => ({ agreement: { version: 1 } }) };
  const service = new MonitoringEvidenceService(prisma as never, access as never);
  await service.build(context as never, "agreement", start.toISOString(), end.toISOString());
  assert.deepEqual(created?.records.create.map((entry) => entry.observationId), ["closing-slot", "earlier-slot-late"]);
});


function evidenceFixture(overrides: Record<string, unknown> = {}, retained = true) {
  let stored = false;
  const row = { id: "closing-slot", agreementVersion: 1, sourceId: "source", trustCategory: "OPERATOR_COLLECTED", observedAt: end, ingestedAt: end, scheduledFor: end,
    method: "HTTP_PROBE", httpStatus: 200, latencyMs: 100, reachable: true, errorCategory: null, probeDurationMs: 100, collectionRegion: null, agentIdentity: "probe", validity: "VALID", validityReason: null,
    provenance: {}, source: { name: "Public probe", type: "HTTP_PROBE", trustCategory: "OPERATOR_COLLECTED" } };
  const evaluation = { sourceId: "source", windowStart: start, windowEnd: end, algorithmVersion: "sla-dex-kpi/1", latencyStatistic: "MEAN", expectedSamples: 1, healthyObservations: 1, failedObservations: 0,
    unknownObservations: 0, coveragePercent: { toString: () => "100" }, uptimePercent: { toString: () => "100" }, meanLatencyMs: { toString: () => "100" }, state: "HEALTHY", breachCandidate: null,
    source: { createdAt: start, intervalSeconds: 3600 }, ...overrides };
  const prisma = {
    agreement: { findUniqueOrThrow: async () => ({ version: 1 }) },
    monitoringObservation: { findMany: async () => retained ? [row] : [] },
    signingSnapshot: { findUniqueOrThrow: async () => ({ snapshotHash: "0x" + "11".repeat(32) }) },
    agreementVersion: { findUniqueOrThrow: async () => ({ uptimeTargetPercent: 99, responseTimeTargetMs: 200, measurementWindowHours: 1 }) },
    kpiEvaluation: { findMany: async () => [evaluation] },
    evidenceBatch: { findUnique: async () => null, create: async ({ data }: { data: Record<string, unknown> }) => { stored = true; return { ...data, id: "batch" }; } },
    $executeRaw: async () => 1,
    $transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback(prisma)
  };
  const service = new MonitoringEvidenceService(prisma as never, { requireActiveAgreement: async () => ({ agreement: { version: 1 } }) } as never);
  return { build: () => service.build(context as never, "agreement", start.toISOString(), end.toISOString()), stored: () => stored, prisma };
}

test("unchanged frozen metrics are reproducible from evidence records with Decimal values", async () => {
  const fixture = evidenceFixture();
  await fixture.build();
  assert.equal(fixture.stored(), true);
});

for (const [field, value] of Object.entries({ algorithmVersion: "obsolete", latencyStatistic: "P95", expectedSamples: 2, healthyObservations: 0, failedObservations: 1,
  unknownObservations: 1, coveragePercent: 99, uptimePercent: null, meanLatencyMs: 101, state: "BREACH_CANDIDATE", breachCandidate: { state: "BREACH_CANDIDATE" } })) {
  test("evidence rejects a frozen " + field + " that its selected observations cannot reproduce", async () => {
    const fixture = evidenceFixture({ [field]: value });
    await assert.rejects(fixture.build(), /cannot reproduce a frozen KPI/);
    assert.equal(fixture.stored(), false);
  });
}

test("late data cannot replace a frozen insufficient evaluation with healthy evidence metrics", async () => {
  const fixture = evidenceFixture({ healthyObservations: 0, unknownObservations: 1, coveragePercent: 0, uptimePercent: null, meanLatencyMs: null, state: "INSUFFICIENT_DATA" });
  await assert.rejects(fixture.build(), /cannot reproduce a frozen KPI/);
  assert.equal(fixture.stored(), false);
});

test("retention-deleted evaluation inputs cannot produce a new evidence batch", async () => {
  const fixture = evidenceFixture({}, false);
  await assert.rejects(fixture.build(), /cannot reproduce a frozen KPI/);
  assert.equal(fixture.stored(), false);
});


test("an existing evidence batch remains immutable when late observations no longer match the frozen evaluation", async () => {
  const fixture = evidenceFixture({ state: "INSUFFICIENT_DATA" });
  const cached = { id: "existing-batch", merkleRoot: "0x" + "22".repeat(32) };
  Object.assign(fixture.prisma.evidenceBatch, { findUnique: async () => cached });
  const result = await fixture.build();
  assert.equal(result.id, cached.id);
  assert.equal(result.verification.root, cached.merkleRoot);
  assert.equal(fixture.stored(), false);
});

test("a concurrent batch winner returns its own stored root", async () => {
  const fixture = evidenceFixture();
  const cached = { id: "concurrent-batch", merkleRoot: "0x" + "22".repeat(32) };
  let lookups = 0;
  Object.assign(fixture.prisma.evidenceBatch, { findUnique: async () => ++lookups === 1 ? null : cached });
  const result = await fixture.build();
  assert.equal(result.id, cached.id);
  assert.equal(result.verification.root, cached.merkleRoot);
  assert.equal(fixture.stored(), false);
});

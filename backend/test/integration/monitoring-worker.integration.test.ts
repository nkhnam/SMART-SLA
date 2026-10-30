import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { after, test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../dist/generated/prisma/client.js";
import { MonitoringWorkerService } from "../../dist/monitoring/monitoring-worker.service.js";
import { MonitoringAccessService } from "../../dist/monitoring/monitoring-access.service.js";
import { evaluateKpis } from "../../dist/monitoring/kpi-engine.js";
import type { HttpProbeResult } from "../../src/monitoring/http-probe.js";

const databaseUrl = process.env.DATABASE_URL!;
assert.match(new URL(databaseUrl).pathname, /^\/phase2c_[a-f0-9]{32}_test$/);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
after(() => prisma.$disconnect());

const activeAccess = { requireActiveSource: async () => undefined };
const healthy = (): HttpProbeResult => ({ observedAt: new Date(), httpStatus: 200, latencyMs: 12, reachable: true, errorCategory: null, probeDurationMs: 12 });
function worker(probe: (url: string) => Promise<HttpProbeResult> = async () => healthy(), access = activeAccess) {
  return new MonitoringWorkerService(prisma as never, access as never, probe);
}
async function expire(sourceId: string) {
  await prisma.$executeRaw`UPDATE "MonitoringSource" SET "leaseUntil" = clock_timestamp() - interval '1 second' WHERE "id" = ${sourceId}::uuid`;
}
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function source() {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@worker.example.test`, displayName: "Worker fixture", passwordHash: "test-only" } });
  const organization = await prisma.organization.create({ data: { name: "Synthetic worker fixture", organizationType: "CUSTOMER" } });
  const agreement = await prisma.agreement.create({ data: {
    reference: randomUUID().slice(0, 20), ownerOrganizationId: organization.id, createdByUserId: user.id,
    versions: { create: { version: 1, actorUserId: user.id, name: "Synthetic worker SLA", serviceDescription: "Controlled probe boundary", counterpartyDisplayName: "Fixture", uptimeTargetPercent: 99, responseTimeTargetMs: 200, measurementWindowHours: 1 } }
  } });
  return prisma.monitoringSource.create({ data: {
    organizationId: organization.id, agreementId: agreement.id, agreementVersion: 1, createdByUserId: user.id,
    name: "SYNTHETIC controlled HTTP probe", type: "HTTP_PROBE", trustCategory: "SYNTHETIC_TEST",
    endpointUrl: "https://worker.example.test/", intervalSeconds: 300, nextRunAt: new Date(Date.now() - 1000)
  } });
}

test("restart closes an expired run even when its next schedule is in the future", async () => {
  const fixture = await source();
  const run = await prisma.monitoringRun.create({ data: { sourceId: fixture.id, scheduledFor: fixture.nextRunAt!, startedAt: new Date() } });
  const next = new Date(Date.now() + 300_000);
  await prisma.monitoringSource.update({ where: { id: fixture.id }, data: { nextRunAt: next, leaseOwner: "dead-process", leaseUntil: new Date(Date.now() - 1) } });
  const worker = new MonitoringWorkerService(prisma as never, { requireActiveSource: async () => { throw new Error("Recovery must not probe"); } } as never);
  await worker.processDueSources();
  const recovered = await prisma.monitoringRun.findUniqueOrThrow({ where: { id: run.id } });
  assert.equal(recovered.status, "FAILED");
  assert.equal(recovered.errorCode, "lease_expired");
  assert.ok(recovered.completedAt);
  const observations = await prisma.monitoringObservation.findMany({ where: { sourceId: fixture.id } });
  assert.equal(observations.length, 0);
  const kpi = evaluateKpis({ windowStart: new Date(fixture.nextRunAt!.getTime() - 1), windowEnd: fixture.nextRunAt!, scheduleAnchor: fixture.nextRunAt!, measurementIntervalSeconds: 300, uptimeTargetPercent: 99, responseTimeTargetMs: 200, observations });
  assert.equal(kpi.unknownObservations, 1);
  assert.equal(kpi.failedObservations, 0);
  assert.equal(kpi.healthyObservations, 0);
  assert.equal(kpi.uptimePercent, null);
  assert.equal(kpi.state, "INSUFFICIENT_DATA");
  const current = await prisma.monitoringSource.findUniqueOrThrow({ where: { id: fixture.id } });
  assert.equal(current.nextRunAt?.getTime(), next.getTime());
  assert.equal(current.leaseOwner, null);
  assert.equal(current.lastRunAt, null);
  await worker.processDueSources();
  assert.equal(await prisma.monitoringRun.count({ where: { sourceId: fixture.id } }), 1);
});

test("simultaneous claim transactions produce one run and one observation", async () => {
  const fixture = await source();
  let calls = 0;
  const probe = async () => { calls++; return healthy(); };
  await Promise.all([worker(probe).processDueSources(), worker(probe).processDueSources()]);
  assert.equal(calls, 1);
  assert.equal(await prisma.monitoringRun.count({ where: { sourceId: fixture.id } }), 1);
  assert.equal(await prisma.monitoringObservation.count({ where: { sourceId: fixture.id } }), 1);
});

test("overdue collection keeps the original grid and skips missed intervals without backfill", async () => {
  const fixture = await source();
  const [{ now }] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const scheduledFor = new Date(now.getTime() - 750_000);
  await prisma.monitoringSource.update({ where: { id: fixture.id }, data: { nextRunAt: scheduledFor } });
  await worker().processDueSources();
  const run = await prisma.monitoringRun.findFirstOrThrow({ where: { sourceId: fixture.id } });
  assert.equal(run.scheduledFor.getTime(), scheduledFor.getTime());
  const current = await prisma.monitoringSource.findUniqueOrThrow({ where: { id: fixture.id } });
  assert.equal(current.nextRunAt!.getTime(), scheduledFor.getTime() + 900_000);
  assert.equal(await prisma.monitoringRun.count({ where: { sourceId: fixture.id } }), 1);
});

test("two workers and overlapping polls claim one due execution and restart is idempotent", { timeout: 15_000 }, async () => {
  const fixture = await source();
  const entered = barrier();
  const release = barrier();
  let calls = 0;
  const firstWorker = worker(async () => { calls++; entered.release(); await release.promise; return healthy(); });
  const first = firstWorker.processDueSources();
  try {
    await entered.promise;
    await Promise.all([firstWorker.processDueSources(), worker(async () => { calls++; return healthy(); }).processDueSources()]);
    assert.equal(calls, 1);
    assert.equal(await prisma.monitoringRun.count({ where: { sourceId: fixture.id } }), 1);
    assert.equal(await prisma.monitoringObservation.count({ where: { sourceId: fixture.id } }), 0);
  } finally { release.release(); await first; }
  await worker().processDueSources();
  const run = await prisma.monitoringRun.findFirstOrThrow({ where: { sourceId: fixture.id } });
  assert.equal(run.status, "COMPLETED");
  const observations = await prisma.monitoringObservation.findMany({ where: { sourceId: fixture.id } });
  assert.equal(observations.length, 1);
  assert.equal(observations[0].scheduledFor.getTime(), fixture.nextRunAt!.getTime());
  assert.equal(observations[0].runId, run.id);
  assert.equal(observations[0].agreementVersion, 1);
  await assert.rejects(prisma.monitoringRun.create({ data: { sourceId: fixture.id, scheduledFor: run.scheduledFor } }), { code: "P2002" });
  const duplicate = { ...observations[0], id: randomUUID() };
  await assert.rejects(prisma.monitoringObservation.create({ data: duplicate }), { code: "P2002" });
});

for (const completion of ["success", "throw", "inactive"] as const) {
  test(`late ${completion} cannot write after ownership changes`, { timeout: 15_000 }, async () => {
    const fixture = await source();
    const entered = barrier();
    const release = barrier();
    const access = completion === "inactive" ? { requireActiveSource: async () => { entered.release(); await release.promise; return new MonitoringAccessService(prisma as never, {} as never).requireActiveSource(fixture.agreementId, 1, fixture.organizationId); } } : activeAccess;
    const first = worker(async () => { entered.release(); await release.promise; if (completion === "throw") throw new Error("controlled collection crash"); return healthy(); }, access as never).processDueSources();
    let oldRunId: string;
    let replacementRunId: string;
    try {
      await entered.promise;
      oldRunId = (await prisma.monitoringRun.findFirstOrThrow({ where: { sourceId: fixture.id } })).id;
      await expire(fixture.id);
      await prisma.monitoringSource.update({ where: { id: fixture.id }, data: { nextRunAt: new Date(Date.now() - 1) } });
      const replacementEntered = barrier();
      const replacementRelease = barrier();
      const replacement = worker(async () => { replacementEntered.release(); await replacementRelease.promise; return healthy(); }).processDueSources();
      try {
        await replacementEntered.promise;
        replacementRunId = (await prisma.monitoringRun.findFirstOrThrow({ where: { sourceId: fixture.id, id: { not: oldRunId } } })).id;
        const ownership = await prisma.monitoringSource.findUniqueOrThrow({ where: { id: fixture.id } });
        release.release();
        await first;
        const stillOwned = await prisma.monitoringSource.findUniqueOrThrow({ where: { id: fixture.id } });
        assert.equal(stillOwned.leaseOwner, ownership.leaseOwner);
        assert.equal(stillOwned.enabled, true);
        assert.equal((await prisma.monitoringRun.findUniqueOrThrow({ where: { id: oldRunId } })).status, "FAILED");
        assert.equal(await prisma.monitoringObservation.count({ where: { sourceId: fixture.id } }), 0);
      } finally { replacementRelease.release(); await replacement; }
    } finally { release.release(); await first; }
    const rows = await prisma.monitoringObservation.findMany({ where: { sourceId: fixture.id } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].runId, replacementRunId!);
    assert.equal((await prisma.monitoringRun.findUniqueOrThrow({ where: { id: oldRunId! } })).errorCode, "lease_expired");
  });
}

test("expired lease rejects completion even before another worker reclaims", async () => {
  const fixture = await source();
  await worker(async () => { await expire(fixture.id); return healthy(); }).processDueSources();
  const run = await prisma.monitoringRun.findFirstOrThrow({ where: { sourceId: fixture.id } });
  assert.equal(run.status, "FAILED");
  assert.equal(run.errorCode, "lease_expired");
  assert.equal(await prisma.monitoringObservation.count({ where: { sourceId: fixture.id } }), 0);
});

test("lease time is checked after a blocked finalization acquires the source lock", { timeout: 15_000 }, async () => {
  const fixture = await source();
  const entered = barrier();
  const releaseProbe = barrier();
  const invalidateLease = barrier();
  const lockReady = barrier();
  let blockerPid = 0;
  const first = worker(async () => { entered.release(); await releaseProbe.promise; return healthy(); }).processDueSources();
  await entered.promise;
  const blocker = prisma.$transaction(async (transaction) => {
    const [{ pid }] = await transaction.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    blockerPid = pid;
    await transaction.$queryRaw`SELECT "id" FROM "MonitoringSource" WHERE "id" = ${fixture.id}::uuid FOR UPDATE`;
    lockReady.release();
    await invalidateLease.promise;
    await transaction.$executeRaw`UPDATE "MonitoringSource" SET "leaseUntil" = clock_timestamp() WHERE "id" = ${fixture.id}::uuid`;
  });
  try {
    await lockReady.promise;
    releaseProbe.release();
    const deadline = performance.now() + 3_000;
    let waiting = false;
    while (performance.now() < deadline) {
      const [{ blocked }] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${blockerPid}::int = ANY(pg_blocking_pids(pid))) AS blocked`;
      if (blocked) { waiting = true; break; }
    }
    assert.equal(waiting, true, "finalization must actually queue behind the source lock");
  } finally { invalidateLease.release(); releaseProbe.release(); await blocker; await first; }
  assert.equal(await prisma.monitoringObservation.count({ where: { sourceId: fixture.id } }), 0);
  const run = await prisma.monitoringRun.findFirstOrThrow({ where: { sourceId: fixture.id } });
  assert.equal(run.status, "FAILED");
  assert.equal(run.errorCode, "lease_expired");
});

test("recovery includes disabled sources and missing leases without re-probing old slots", async () => {
  for (const lease of ["missing", "expired"]) {
    const fixture = await source();
    await prisma.monitoringRun.create({ data: { sourceId: fixture.id, scheduledFor: fixture.nextRunAt! } });
    await prisma.monitoringSource.update({ where: { id: fixture.id }, data: { enabled: false, nextRunAt: null, leaseOwner: lease === "missing" ? null : "dead-process", leaseUntil: lease === "missing" ? null : new Date(0) } });
    let calls = 0;
    await Promise.all([worker(async () => { calls++; return healthy(); }).processDueSources(), worker().processDueSources()]);
    const run = await prisma.monitoringRun.findFirstOrThrow({ where: { sourceId: fixture.id } });
    assert.equal(run.status, "FAILED");
    assert.equal(run.errorCode, lease === "missing" ? "lease_missing" : "lease_expired");
    assert.equal(calls, 0);
    assert.equal(await prisma.monitoringObservation.count({ where: { sourceId: fixture.id } }), 0);
  }
});

for (const category of ["TIMEOUT", "DNS", "CONNECTION", "TLS", "HTTP", "INVALID_RESPONSE", "RESPONSE_TOO_LARGE"] as const) {
  test(`${category} probe result persists its measurement validity and releases the lease`, async () => {
    const fixture = await source();
    await worker(async () => ({ ...healthy(), httpStatus: category === "HTTP" ? 503 : null, latencyMs: null, reachable: false, errorCategory: category })).processDueSources();
    const observation = await prisma.monitoringObservation.findFirstOrThrow({ where: { sourceId: fixture.id } });
    const invalid = ["INVALID_RESPONSE", "RESPONSE_TOO_LARGE"].includes(category);
    assert.equal(observation.errorCategory, category);
    assert.equal(observation.validity, invalid ? "INVALID" : "VALID");
    assert.equal(observation.reachable, invalid ? null : false);
    assert.equal((await prisma.monitoringRun.findFirstOrThrow({ where: { sourceId: fixture.id } })).status, "COMPLETED");
    assert.equal((await prisma.monitoringSource.findUniqueOrThrow({ where: { id: fixture.id } })).leaseOwner, null);
  });
}

test("unexpected collection errors leave an explicit failed run without fabricating downtime", async () => {
  const fixture = await source();
  await worker(async () => { throw new TypeError("controlled collector failure"); }).processDueSources();
  const run = await prisma.monitoringRun.findFirstOrThrow({ where: { sourceId: fixture.id } });
  assert.equal(run.status, "FAILED");
  assert.equal(run.errorCode, "TypeError");
  assert.equal(await prisma.monitoringObservation.count({ where: { sourceId: fixture.id } }), 0);
  assert.equal((await prisma.monitoringSource.findUniqueOrThrow({ where: { id: fixture.id } })).enabled, true);
});

test("inactive agreement disables only the owned source without an observation", async () => {
  const fixture = await source();
  let calls = 0;
  await worker(async () => { calls++; return healthy(); }, new MonitoringAccessService(prisma as never, {} as never) as never).processDueSources();
  const run = await prisma.monitoringRun.findFirstOrThrow({ where: { sourceId: fixture.id } });
  assert.equal(run.status, "FAILED");
  assert.equal(run.errorCode, "agreement_version_inactive");
  const current = await prisma.monitoringSource.findUniqueOrThrow({ where: { id: fixture.id } });
  assert.equal(current.enabled, false);
  assert.equal(current.nextRunAt, null);
  assert.equal(calls, 0);
});

test("transient PostgreSQL authorization read failure does not disable a source", async () => {
  const fixture = await source();
  await worker(async () => healthy(), { requireActiveSource: async () => { await prisma.$executeRawUnsafe("DO $$ BEGIN RAISE EXCEPTION 'controlled transient read failure' USING ERRCODE = '40001'; END $$"); } }).processDueSources();
  const current = await prisma.monitoringSource.findUniqueOrThrow({ where: { id: fixture.id } });
  assert.equal(current.enabled, true);
  assert.ok(current.nextRunAt);
  const run = await prisma.monitoringRun.findFirstOrThrow({ where: { sourceId: fixture.id } });
  assert.equal(run.status, "FAILED");
  assert.match(run.errorCode!, /^database_/);
  assert.equal(await prisma.monitoringObservation.count({ where: { sourceId: fixture.id } }), 0);
});

test("process killed at the probe boundary recovers its committed run without replaying the old measurement", { timeout: 15_000 }, async (t) => {
  const fixture = await source();
  const child = spawn(process.execPath, ["--input-type=module", "--eval", `
    import "reflect-metadata";
    import { PrismaPg } from "@prisma/adapter-pg";
    import { PrismaClient } from "./dist/generated/prisma/client.js";
    import { MonitoringWorkerService } from "./dist/monitoring/monitoring-worker.service.js";
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await new MonitoringWorkerService(prisma, { requireActiveSource: async () => {} }, async () => {
      process.send("probe-entered");
      await new Promise(() => {});
    }).processDueSources();
  `], { cwd: process.cwd(), env: process.env, windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let diagnostics = "";
  child.stderr.on("data", (chunk) => { diagnostics += chunk; });
  const closed = once(child, "close");
  const stop = () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };
  t.signal.addEventListener("abort", stop, { once: true });
  t.after(async () => { stop(); await closed; });
  try {
    const entered = await Promise.race([once(child, "message"), closed.then(() => { throw new Error(`Crash fixture exited before probe: ${diagnostics}`); })]);
    assert.equal(entered[0], "probe-entered");
    const committed = await prisma.monitoringRun.findFirstOrThrow({ where: { sourceId: fixture.id } });
    assert.equal(committed.status, "RUNNING");
    const claimed = await prisma.monitoringSource.findUniqueOrThrow({ where: { id: fixture.id } });
    assert.ok(claimed.nextRunAt! > fixture.nextRunAt!);
    child.kill("SIGKILL");
    await closed;
    await worker().processDueSources();
    assert.equal((await prisma.monitoringRun.findUniqueOrThrow({ where: { id: committed.id } })).status, "RUNNING", "unexpired lease must survive restart");
    await expire(fixture.id);
    await worker().processDueSources();
    const recovered = await prisma.monitoringRun.findUniqueOrThrow({ where: { id: committed.id } });
    assert.equal(recovered.status, "FAILED");
    assert.equal(recovered.errorCode, "lease_expired");
    assert.equal(await prisma.monitoringObservation.count({ where: { sourceId: fixture.id } }), 0);
    assert.equal((await prisma.monitoringSource.findUniqueOrThrow({ where: { id: fixture.id } })).nextRunAt!.getTime(), claimed.nextRunAt!.getTime());
  } finally { stop(); await closed; t.signal.removeEventListener("abort", stop); }
});

test("PostgreSQL failure advancing a claimed source rolls back run creation and leaves the schedule retryable", async () => {
  const fixture = await source();
  await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_monitoring_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."id" = '${fixture.id}'::uuid AND NEW."leaseOwner" IS NOT NULL THEN RAISE EXCEPTION 'controlled claim failure' USING ERRCODE = '40001'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe('CREATE TRIGGER fail_monitoring_claim BEFORE UPDATE ON "MonitoringSource" FOR EACH ROW EXECUTE FUNCTION fail_monitoring_claim()');
  try {
    await worker().processDueSources();
    assert.equal(await prisma.monitoringRun.count({ where: { sourceId: fixture.id } }), 0);
    const current = await prisma.monitoringSource.findUniqueOrThrow({ where: { id: fixture.id } });
    assert.equal(current.nextRunAt!.getTime(), fixture.nextRunAt!.getTime());
    assert.equal(current.leaseOwner, null);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER fail_monitoring_claim ON "MonitoringSource"');
    await prisma.$executeRawUnsafe('DROP FUNCTION fail_monitoring_claim()');
  }
  await worker().processDueSources();
  assert.equal(await prisma.monitoringRun.count({ where: { sourceId: fixture.id, status: "COMPLETED" } }), 1);
  assert.equal(await prisma.monitoringObservation.count({ where: { sourceId: fixture.id } }), 1);
});

test("failed failure-persistence retains RUNNING for lease recovery rather than losing the orphan", async () => {
  const fixture = await source();
  await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_monitoring_terminal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."sourceId" = '${fixture.id}'::uuid AND NEW."status" = 'FAILED' THEN RAISE EXCEPTION 'controlled terminal failure' USING ERRCODE = '40001'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe('CREATE TRIGGER fail_monitoring_terminal BEFORE UPDATE ON "MonitoringRun" FOR EACH ROW EXECUTE FUNCTION fail_monitoring_terminal()');
  try {
    await worker(async () => { throw new Error("controlled collector crash"); }).processDueSources();
    const run = await prisma.monitoringRun.findFirstOrThrow({ where: { sourceId: fixture.id } });
    assert.equal(run.status, "RUNNING");
    assert.equal(run.completedAt, null);
    assert.equal(await prisma.monitoringObservation.count({ where: { sourceId: fixture.id } }), 0);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER fail_monitoring_terminal ON "MonitoringRun"');
    await prisma.$executeRawUnsafe('DROP FUNCTION fail_monitoring_terminal()');
  }
  await expire(fixture.id);
  await worker().processDueSources();
  const recovered = await prisma.monitoringRun.findFirstOrThrow({ where: { sourceId: fixture.id } });
  assert.equal(recovered.status, "FAILED");
  assert.equal(recovered.errorCode, "lease_expired");
  assert.equal(await prisma.monitoringObservation.count({ where: { sourceId: fixture.id } }), 0);
});

test("PostgreSQL serialization failure rolls back observation and completion, then a new schedule succeeds", async () => {
  const fixture = await source();
  await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_monitoring_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."sourceId" = '${fixture.id}'::uuid THEN RAISE EXCEPTION 'controlled serialization failure' USING ERRCODE = '40001'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe('CREATE TRIGGER fail_monitoring_insert BEFORE INSERT ON "MonitoringObservation" FOR EACH ROW EXECUTE FUNCTION fail_monitoring_insert()');
  try {
    await worker().processDueSources();
    const run = await prisma.monitoringRun.findFirstOrThrow({ where: { sourceId: fixture.id } });
    assert.equal(run.status, "FAILED");
    assert.match(run.errorCode!, /^database_/);
    assert.equal(await prisma.monitoringObservation.count({ where: { sourceId: fixture.id } }), 0);
    const current = await prisma.monitoringSource.findUniqueOrThrow({ where: { id: fixture.id } });
    assert.equal(current.enabled, true);
    assert.equal(current.leaseOwner, null);
    assert.equal(current.lastRunAt, null);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER fail_monitoring_insert ON "MonitoringObservation"');
    await prisma.$executeRawUnsafe('DROP FUNCTION fail_monitoring_insert()');
  }
  await prisma.monitoringSource.update({ where: { id: fixture.id }, data: { nextRunAt: new Date(Date.now() - 1) } });
  await worker().processDueSources();
  assert.equal(await prisma.monitoringObservation.count({ where: { sourceId: fixture.id } }), 1);
  assert.equal(await prisma.monitoringRun.count({ where: { sourceId: fixture.id, status: "FAILED" } }), 1);
  assert.equal(await prisma.monitoringRun.count({ where: { sourceId: fixture.id, status: "COMPLETED" } }), 1);
});

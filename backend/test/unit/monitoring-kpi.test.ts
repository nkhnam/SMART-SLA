import assert from "node:assert/strict";
import { test } from "node:test";

const enginePromise = import("../../src/monitoring/kpi-engine.js").catch(() => undefined);

test("counts missing samples as unknown and refuses a low-coverage success", async () => {
  const engine = await enginePromise;
  assert.ok(engine, "monitoring KPI engine must be available");

  const result = engine.evaluateKpis({
    windowStart: new Date("2026-01-01T00:00:00.000Z"),
    windowEnd: new Date("2026-01-01T00:10:00.000Z"),
    measurementIntervalSeconds: 60,
    uptimeTargetPercent: 99,
    responseTimeTargetMs: 200,
    observations: [
      { scheduledFor: new Date("2026-01-01T00:01:00.000Z"), valid: true, reachable: true, latencyMs: 100 },
      { scheduledFor: new Date("2026-01-01T00:02:00.000Z"), valid: true, reachable: true, latencyMs: 100 }
    ]
  });

  assert.equal(result.expectedSamples, 10);
  assert.equal(result.healthyObservations, 2);
  assert.equal(result.failedObservations, 0);
  assert.equal(result.unknownObservations, 8);
  assert.equal(result.coveragePercent, 20);
  assert.equal(result.state, "INSUFFICIENT_DATA");
  assert.equal(result.uptimePercent, null);
});

test("marks a sufficiently covered window below the signed uptime target as a candidate", async () => {
  const engine = await enginePromise;
  assert.ok(engine, "monitoring KPI engine must be available");

  const observations = Array.from({ length: 10 }, (_, index) => ({
    scheduledFor: new Date(Date.parse("2026-01-01T00:00:00.000Z") + (index + 1) * 60_000),
    valid: true,
    reachable: index < 9,
    latencyMs: index < 9 ? 100 : null
  }));
  const result = engine.evaluateKpis({
    windowStart: new Date("2026-01-01T00:00:00.000Z"),
    windowEnd: new Date("2026-01-01T00:10:00.000Z"),
    measurementIntervalSeconds: 60,
    uptimeTargetPercent: 99,
    responseTimeTargetMs: 200,
    observations
  });

  assert.equal(result.coveragePercent, 100);
  assert.equal(result.uptimePercent, 90);
  assert.equal(result.failedObservations, 1);
  assert.equal(result.state, "BREACH_CANDIDATE");
});

test("uses arithmetic mean latency without claiming a percentile", async () => {
  const engine = await enginePromise;
  assert.ok(engine, "monitoring KPI engine must be available");

  const observations = Array.from({ length: 10 }, (_, index) => ({
    scheduledFor: new Date(Date.parse("2026-01-01T00:00:00.000Z") + (index + 1) * 60_000),
    valid: true,
    reachable: true,
    latencyMs: index === 9 ? 401 : 100
  }));
  const result = engine.evaluateKpis({
    windowStart: new Date("2026-01-01T00:00:00.000Z"),
    windowEnd: new Date("2026-01-01T00:10:00.000Z"),
    measurementIntervalSeconds: 60,
    uptimeTargetPercent: 99,
    responseTimeTargetMs: 120,
    observations
  });

  assert.equal(result.latencyStatistic, "MEAN");
  assert.equal(result.meanLatencyMs, 130.1);
  assert.equal(result.state, "BREACH_CANDIDATE");
});

test("returns unknown for an empty window instead of success or failure", async () => {
  const engine = await enginePromise;
  assert.ok(engine, "monitoring KPI engine must be available");

  const result = engine.evaluateKpis({
    windowStart: new Date("2026-01-01T00:00:00.000Z"),
    windowEnd: new Date("2026-01-01T00:10:00.000Z"),
    measurementIntervalSeconds: 60,
    uptimeTargetPercent: 99,
    responseTimeTargetMs: 200,
    observations: []
  });

  assert.equal(result.healthyObservations, 0);
  assert.equal(result.failedObservations, 0);
  assert.equal(result.unknownObservations, 10);
  assert.equal(result.state, "INSUFFICIENT_DATA");
  assert.equal(result.uptimePercent, null);
  assert.equal(result.meanLatencyMs, null);
});

test("anchors expected slots to source creation rather than the requested window boundary", async () => {
  const engine = await enginePromise;
  assert.ok(engine, "monitoring KPI engine must be available");
  const result = engine.evaluateKpis({
    windowStart: new Date("2026-01-01T00:02:00.000Z"),
    windowEnd: new Date("2026-01-01T00:05:00.000Z"),
    scheduleAnchor: new Date("2026-01-01T00:00:00.000Z"),
    measurementIntervalSeconds: 60,
    uptimeTargetPercent: 99,
    responseTimeTargetMs: 200,
    observations: [
      { scheduledFor: new Date("2026-01-01T00:03:00.000Z"), valid: true, reachable: true, latencyMs: 100 },
      { scheduledFor: new Date("2026-01-01T00:05:00.000Z"), valid: true, reachable: true, latencyMs: 100 }
    ]
  });

  assert.equal(result.expectedSamples, 3);
  assert.equal(result.healthyObservations, 2);
  assert.equal(result.unknownObservations, 1);
  assert.equal(result.coveragePercent, 66.67);
  assert.equal(result.state, "INSUFFICIENT_DATA");
});


test("assigns provider timestamps to closing sampling slots without requiring exact millisecond alignment", async () => {
  const engine = await enginePromise;
  assert.ok(engine);
  const anchor = new Date("2026-01-01T00:00:00.123Z");
  const observations = Array.from({ length: 60 }, (_, index) => ({
    scheduledFor: engine.normalizeWebhookScheduledFor(new Date(anchor.getTime() + index * 60_000 + 777), anchor, 60),
    valid: true, reachable: true, latencyMs: 100
  }));
  const result = engine.evaluateKpis({ windowStart: anchor, windowEnd: new Date(anchor.getTime() + 3_600_000), scheduleAnchor: anchor,
    measurementIntervalSeconds: 60, uptimeTargetPercent: 99, responseTimeTargetMs: 200, observations });
  assert.equal(result.expectedSamples, 60);
  assert.equal(result.healthyObservations, 60);
  assert.equal(result.coveragePercent, 100);
  assert.equal(result.state, "HEALTHY");
  assert.equal(engine.normalizeWebhookScheduledFor(new Date(anchor.getTime() + 60_000), anchor, 60).getTime(), anchor.getTime() + 60_000);
  assert.equal(engine.normalizeWebhookScheduledFor(new Date(anchor.getTime() + 3_600_001), anchor, 60).getTime(), anchor.getTime() + 3_660_000);
  assert.throws(() => engine.normalizeWebhookScheduledFor(new Date(anchor.getTime() - 1), anchor, 60), RangeError);
});

test("duplicate provider events cannot increase coverage or replace the first observation in a slot", async () => {
  const engine = await enginePromise;
  assert.ok(engine);
  const anchor = new Date("2026-01-01T00:00:00.123Z");
  const scheduledFor = engine.normalizeWebhookScheduledFor(new Date(anchor.getTime() + 777), anchor, 60);
  const result = engine.evaluateKpis({ windowStart: anchor, windowEnd: new Date(anchor.getTime() + 60_000), scheduleAnchor: anchor,
    measurementIntervalSeconds: 60, uptimeTargetPercent: 99, responseTimeTargetMs: 200,
    observations: [ { scheduledFor, valid: true, reachable: false, latencyMs: null }, { scheduledFor, valid: true, reachable: true, latencyMs: 100 } ] });
  assert.equal(result.healthyObservations, 0);
  assert.equal(result.failedObservations, 1);
  assert.equal(result.coveragePercent, 100);
  assert.equal(result.state, "BREACH_CANDIDATE");
});

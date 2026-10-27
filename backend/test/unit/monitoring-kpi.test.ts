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

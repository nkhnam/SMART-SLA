import assert from "node:assert/strict";
import { test } from "node:test";

const comparisonModule = await import("../lib/monitoring-comparison.ts");

test("compares only sources with matching signed-version windows and exposes disagreement", () => {
  const result = comparisonModule.compareMonitoringSources([
    { agreementVersion: 2, windowStart: "2026-01-01T00:00:00.000Z", windowEnd: "2026-01-01T01:00:00.000Z", sourceId: "a", sourceName: "Operator", trustCategory: "OPERATOR_COLLECTED", coveragePercent: 100, healthyObservations: 59, failedObservations: 1, uptimePercent: 98.33, meanLatencyMs: 100, state: "BREACH_CANDIDATE" },
    { agreementVersion: 2, windowStart: "2026-01-01T00:00:00.000Z", windowEnd: "2026-01-01T01:00:00.000Z", sourceId: "b", sourceName: "Provider", trustCategory: "PROVIDER_REPORTED", coveragePercent: 90, healthyObservations: 60, failedObservations: 0, uptimePercent: 100, meanLatencyMs: 160, state: "HEALTHY" },
    { agreementVersion: 1, windowStart: "2026-01-01T00:00:00.000Z", windowEnd: "2026-01-01T01:00:00.000Z", sourceId: "old", sourceName: "Old version", trustCategory: "OPERATOR_COLLECTED", coveragePercent: 100, healthyObservations: 60, failedObservations: 0, uptimePercent: 100, meanLatencyMs: 90, state: "HEALTHY" }
  ], 2);

  assert.equal(result.state, "DISAGREEMENT");
  assert.equal(result.coverageDifferencePercent, 10);
  assert.equal(result.uptimeDifferencePercent, 1.67);
  assert.equal(result.latencyDifferenceMs, 60);
  assert.equal(result.healthResultsDiffer, true);
  assert.deepEqual(result.sources.map((source) => source.trustCategory), ["OPERATOR_COLLECTED", "PROVIDER_REPORTED"]);
  assert.equal(result.sources.some((source) => source.sourceId === "old"), false);
});

test("reports insufficient comparison when overlapping sources lack minimum coverage", () => {
  const result = comparisonModule.compareMonitoringSources([
    { agreementVersion: 1, windowStart: "start", windowEnd: "end", sourceId: "a", sourceName: "A", trustCategory: "OPERATOR_COLLECTED", coveragePercent: 70, healthyObservations: 7, failedObservations: 0, uptimePercent: null, meanLatencyMs: 12, state: "INSUFFICIENT_DATA" },
    { agreementVersion: 1, windowStart: "start", windowEnd: "end", sourceId: "b", sourceName: "B", trustCategory: "PROVIDER_REPORTED", coveragePercent: 75, healthyObservations: 8, failedObservations: 0, uptimePercent: null, meanLatencyMs: 13, state: "INSUFFICIENT_DATA" }
  ], 1);

  assert.equal(result.state, "INSUFFICIENT_COMPARISON");
  assert.equal(result.uptimeDifferencePercent, null);
  assert.equal(result.healthResultsDiffer, null);
});

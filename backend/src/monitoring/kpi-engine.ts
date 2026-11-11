export const kpiAlgorithmVersion = "sla-dex-kpi/1";
export const minimumWindowCoveragePercent = 80;

export type KpiObservationInput = {
  scheduledFor: Date;
  valid: boolean;
  reachable: boolean | null;
  latencyMs: number | null;
};

export type KpiEvaluationInput = {
  windowStart: Date;
  windowEnd: Date;
  measurementIntervalSeconds: number;
  scheduleAnchor?: Date;
  uptimeTargetPercent: number;
  responseTimeTargetMs: number;
  observations: KpiObservationInput[];
};

export type KpiEvaluation = {
  algorithmVersion: string;
  latencyStatistic: "MEAN";
  expectedSamples: number;
  healthyObservations: number;
  failedObservations: number;
  unknownObservations: number;
  coveragePercent: number;
  uptimePercent: number | null;
  meanLatencyMs: number | null;
  state: "HEALTHY" | "DEGRADED" | "BREACH_CANDIDATE" | "UNKNOWN" | "INSUFFICIENT_DATA";
};

export function evaluateKpis(input: KpiEvaluationInput): KpiEvaluation {
  const windowStart = input.windowStart.getTime();
  const windowEnd = input.windowEnd.getTime();
  const intervalMs = input.measurementIntervalSeconds * 1000;
  if (!Number.isFinite(windowStart) || !Number.isFinite(windowEnd) || windowEnd <= windowStart) {
    throw new RangeError("KPI window must have a positive duration.");
  }
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) throw new RangeError("Measurement interval must be positive.");
  if (!Number.isFinite(input.uptimeTargetPercent) || input.uptimeTargetPercent < 0 || input.uptimeTargetPercent > 100) {
    throw new RangeError("Uptime target must be between 0 and 100 percent.");
  }
  if (!Number.isSafeInteger(input.responseTimeTargetMs) || input.responseTimeTargetMs < 0) {
    throw new RangeError("Response time target must be a non-negative integer.");
  }

  const anchor = input.scheduleAnchor?.getTime() ?? windowStart;
  const firstExpectedAt = anchor + Math.max(0, Math.floor((windowStart - anchor) / intervalMs) + 1) * intervalMs;
  const expectedSamples = firstExpectedAt > windowEnd ? 0 : Math.floor((windowEnd - firstExpectedAt) / intervalMs) + 1;
  const scheduled = new Map<number, KpiObservationInput>();
  for (const observation of input.observations) {
    const scheduledFor = observation.scheduledFor.getTime();
    const offset = scheduledFor - firstExpectedAt;
    if (offset < 0 || scheduledFor > windowEnd || offset % intervalMs !== 0) continue;
    if (!scheduled.has(scheduledFor)) scheduled.set(scheduledFor, observation);
  }

  const valid = [...scheduled.values()].filter((observation) => observation.valid && observation.reachable !== null);
  const healthyObservations = valid.filter((observation) => observation.reachable === true).length;
  const failedObservations = valid.length - healthyObservations;
  const unknownObservations = Math.max(0, expectedSamples - valid.length);
  const coveragePercent = expectedSamples === 0 ? 0 : roundToTwoDecimals(valid.length * 100 / expectedSamples);
  const observedUptimePercent = valid.length === 0 ? null : roundToTwoDecimals(healthyObservations * 100 / valid.length);
  const uptimePercent = coveragePercent >= minimumWindowCoveragePercent ? observedUptimePercent : null;
  const latencyValues = valid.flatMap((observation) => observation.latencyMs === null ? [] : [observation.latencyMs]);
  const meanLatencyMs = latencyValues.length === 0
    ? null
    : roundToTwoDecimals(latencyValues.reduce((total, latency) => total + latency, 0) / latencyValues.length);

  let state: KpiEvaluation["state"];
  if (valid.length === 0) {
    state = "INSUFFICIENT_DATA";
  } else if (coveragePercent < minimumWindowCoveragePercent) {
    state = "INSUFFICIENT_DATA";
  } else if (
    (uptimePercent !== null && uptimePercent < input.uptimeTargetPercent)
    || (meanLatencyMs !== null && meanLatencyMs > input.responseTimeTargetMs)
  ) {
    state = "BREACH_CANDIDATE";
  } else if (failedObservations > 0) {
    state = "DEGRADED";
  } else {
    state = "HEALTHY";
  }

  return {
    algorithmVersion: kpiAlgorithmVersion,
    latencyStatistic: "MEAN",
    expectedSamples,
    healthyObservations,
    failedObservations,
    unknownObservations,
    coveragePercent,
    uptimePercent,
    meanLatencyMs,
    state
  };
}

function roundToTwoDecimals(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Provider measurements in (slotStart, slotEnd] belong to the closing slot. */
export function normalizeWebhookScheduledFor(observedAt: Date, scheduleAnchor: Date, intervalSeconds: number): Date {
  const observed = observedAt.getTime();
  const anchor = scheduleAnchor.getTime();
  const intervalMs = intervalSeconds * 1000;
  if (!Number.isFinite(observed) || !Number.isFinite(anchor) || observed < anchor) {
    throw new RangeError("A webhook observation cannot predate its monitoring source.");
  }
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) throw new RangeError("Measurement interval must be positive.");
  return new Date(anchor + Math.ceil((observed - anchor) / intervalMs) * intervalMs);
}

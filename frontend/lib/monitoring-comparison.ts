export type MonitoringComparisonInput = {
  agreementVersion: number;
  windowStart: string;
  windowEnd: string;
  sourceId: string;
  sourceName: string;
  trustCategory: string;
  coveragePercent: number | string;
  healthyObservations: number;
  failedObservations: number;
  uptimePercent: number | string | null;
  meanLatencyMs: number | string | null;
  state: string;
};

export type MonitoringSourceComparison = {
  state: "AGREEMENT" | "DISAGREEMENT" | "INSUFFICIENT_COMPARISON";
  windowStart: string | null;
  windowEnd: string | null;
  sources: Array<{
    sourceId: string;
    sourceName: string;
    trustCategory: string;
    coveragePercent: number;
    healthResult: "HEALTHY" | "DEGRADED" | "FAILED" | "UNKNOWN";
    uptimePercent: number | null;
    meanLatencyMs: number | null;
  }>;
  coverageDifferencePercent: number | null;
  healthResultsDiffer: boolean | null;
  uptimeDifferencePercent: number | null;
  latencyDifferenceMs: number | null;
};

export function compareMonitoringSources(evaluations: MonitoringComparisonInput[], agreementVersion: number): MonitoringSourceComparison {
  const windows = new Map<string, MonitoringComparisonInput[]>();
  for (const evaluation of evaluations) {
    if (evaluation.agreementVersion !== agreementVersion) continue;
    const key = `${evaluation.windowStart}\u0000${evaluation.windowEnd}`;
    const group = windows.get(key) ?? [];
    group.push(evaluation);
    windows.set(key, group);
  }

  const comparable = [...windows.values()]
    .filter((group) => new Set(group.map((item) => item.sourceId)).size >= 2)
    .sort((left, right) => right[0]!.windowEnd.localeCompare(left[0]!.windowEnd))[0] ?? [];
  const sources = comparable.map((item) => {
    const coveragePercent = Number(item.coveragePercent);
    const uptimePercent = item.uptimePercent === null ? null : Number(item.uptimePercent);
    const meanLatencyMs = item.meanLatencyMs === null ? null : Number(item.meanLatencyMs);
    const healthResult: MonitoringSourceComparison["sources"][number]["healthResult"] = coveragePercent < 80 || item.state === "INSUFFICIENT_DATA"
      ? "UNKNOWN"
      : item.failedObservations === 0
        ? "HEALTHY"
        : item.healthyObservations === 0 ? "FAILED" : "DEGRADED";
    return { sourceId: item.sourceId, sourceName: item.sourceName, trustCategory: item.trustCategory, coveragePercent, healthResult, uptimePercent, meanLatencyMs };
  }).sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const knownHealth = sources.filter((item) => item.healthResult !== "UNKNOWN").map((item) => item.healthResult);
  const healthResultsDiffer = knownHealth.length >= 2 ? new Set(knownHealth).size > 1 : null;
  const insufficient = sources.length < 2 || sources.some((item) => item.coveragePercent < 80) || healthResultsDiffer === null;
  const range = (values: Array<number | null>) => {
    const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
    return known.length >= 2 ? roundToTwoDecimals(Math.max(...known) - Math.min(...known)) : null;
  };
  const disagreements = healthResultsDiffer === true || (range(sources.map((item) => item.uptimePercent)) ?? 0) > 0 || (range(sources.map((item) => item.meanLatencyMs)) ?? 0) > 0;

  return {
    state: insufficient ? "INSUFFICIENT_COMPARISON" : disagreements ? "DISAGREEMENT" : "AGREEMENT",
    windowStart: sources.length ? comparable[0]!.windowStart : null,
    windowEnd: sources.length ? comparable[0]!.windowEnd : null,
    sources,
    coverageDifferencePercent: range(sources.map((item) => item.coveragePercent)),
    healthResultsDiffer,
    uptimeDifferencePercent: range(sources.map((item) => item.uptimePercent)),
    latencyDifferenceMs: range(sources.map((item) => item.meanLatencyMs))
  };
}

function roundToTwoDecimals(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

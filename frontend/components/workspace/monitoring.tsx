"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageTitle, Status } from "@/components/ui";
import { ApiError, buildEvidenceBatch, createMonitoringSource, evaluateMonitoringKpis, exportEvidenceBatch, listAgreements, listMonitoringBreaches, listMonitoringKpis, listMonitoringObservations, listMonitoringSources, updateMonitoringSource, type EvidenceBatch, type LiveAgreement, type MonitoringBreach, type MonitoringEvaluation, type MonitoringObservation, type MonitoringSource } from "@/lib/live-api";
import { useWorkspace } from "./workspace-context";

export function LiveMonitoring() {
  const { selectedOrganization } = useWorkspace();
  const [agreements, setAgreements] = useState<LiveAgreement[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [sources, setSources] = useState<MonitoringSource[]>([]);
  const [observations, setObservations] = useState<MonitoringObservation[]>([]);
  const [evaluations, setEvaluations] = useState<MonitoringEvaluation[]>([]);
  const [breaches, setBreaches] = useState<MonitoringBreach[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sourceName, setSourceName] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState(300);
  const [sourceType, setSourceType] = useState<MonitoringSource["type"]>("HTTP_PROBE");
  const [notice, setNotice] = useState<string | null>(null);
  const [batch, setBatch] = useState<EvidenceBatch | null>(null);
  const [evaluationWindow, setEvaluationWindow] = useState<{ windowStart: string; windowEnd: string } | null>(null);

  const agreement = useMemo(() => agreements.find((item) => item.id === selectedId) ?? null, [agreements, selectedId]);
  const comparableEvaluations = useMemo(() => {
    const latest = evaluations[0];
    return latest ? evaluations.filter((item) => item.windowStart === latest.windowStart && item.windowEnd === latest.windowEnd) : [];
  }, [evaluations]);
  const sourceRange = useMemo(() => {
    const uptimes = comparableEvaluations.flatMap((item) => item.uptimePercent === null ? [] : [Number(item.uptimePercent)]);
    const latencies = comparableEvaluations.flatMap((item) => item.meanLatencyMs === null ? [] : [Number(item.meanLatencyMs)]);
    return {
      uptime: uptimes.length > 1 ? Math.max(...uptimes) - Math.min(...uptimes) : null,
      latency: latencies.length > 1 ? Math.max(...latencies) - Math.min(...latencies) : null
    };
  }, [comparableEvaluations]);
  const reload = useCallback(async (organizationId: string, agreementId: string) => {
    const [sourceResult, observationResult, kpiResult, breachResult] = await Promise.all([
      listMonitoringSources(organizationId, agreementId), listMonitoringObservations(organizationId, agreementId), listMonitoringKpis(organizationId, agreementId), listMonitoringBreaches(organizationId, agreementId)
    ]);
    setSources(sourceResult);
    setObservations(observationResult.data);
    setEvaluations(kpiResult);
    setBreaches(breachResult);
    setError(null);
  }, []);

  useEffect(() => {
    if (!selectedOrganization) return;
    let active = true;
    listAgreements(selectedOrganization.id).then((result) => {
      if (!active) return;
      const confirmed = result.data.filter((item) => item.status === "ANCHOR_CONFIRMED");
      setAgreements(confirmed);
      setSelectedId((current) => confirmed.some((item) => item.id === current) ? current : confirmed[0]?.id ?? "");
    }).catch((cause) => { if (active) setError(cause instanceof ApiError ? cause.message : "Agreements could not be loaded."); });
    return () => { active = false; };
  }, [selectedOrganization]);

  useEffect(() => {
    if (!selectedOrganization || !selectedId) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      reload(selectedOrganization.id, selectedId).catch((cause) => { if (active) setError(cause instanceof ApiError ? cause.message : "Monitoring data could not be loaded."); });
    });
    return () => { active = false; };
  }, [selectedOrganization, selectedId, reload]);

  async function addSource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrganization || !agreement) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const created = await createMonitoringSource(selectedOrganization.id, agreement.id, { type: sourceType, name: sourceName, ...(sourceType === "HTTP_PROBE" ? { endpointUrl } : {}), intervalSeconds, retentionDays: 90 });
      setNotice(created.webhookSecret ? `${created.name} is configured. Copy this one-time webhook secret now: ${created.webhookSecret}` : `${created.name} is configured. The first probe is queued.`);
      setSourceName(""); setEndpointUrl("");
      await reload(selectedOrganization.id, agreement.id);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "The monitoring source could not be created."); }
    finally { setBusy(false); }
  }

  async function updateSource(source: MonitoringSource, body: { enabled?: boolean; rotateWebhookSecret?: boolean }) {
    if (!selectedOrganization || !agreement) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const updated = await updateMonitoringSource(selectedOrganization.id, agreement.id, source.id, body);
      setNotice(updated.webhookSecret ? `New webhook secret for ${updated.name}; copy it now: ${updated.webhookSecret}` : `${updated.name} updated.`);
      await reload(selectedOrganization.id, agreement.id);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "The source could not be updated."); }
    finally { setBusy(false); }
  }

  async function evaluate() {
    if (!selectedOrganization || !agreement) return;
    const end = new Date(); const start = new Date(end.getTime() - agreement.terms.measurementWindowHours * 3_600_000);
    const window = { windowStart: start.toISOString(), windowEnd: end.toISOString() };
    setBusy(true); setError(null);
    try {
      await evaluateMonitoringKpis(selectedOrganization.id, agreement.id, window);
      setEvaluationWindow(window);
      await reload(selectedOrganization.id, agreement.id);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "KPI evaluation failed."); }
    finally { setBusy(false); }
  }

  async function createEvidence() {
    if (!selectedOrganization || !agreement) return;
    const end = new Date(); const start = new Date(end.getTime() - agreement.terms.measurementWindowHours * 3_600_000);
    const window = evaluationWindow ?? { windowStart: start.toISOString(), windowEnd: end.toISOString() };
    setBusy(true); setError(null);
    try {
      if (!evaluationWindow) await evaluateMonitoringKpis(selectedOrganization.id, agreement.id, window);
      setEvaluationWindow(window);
      setBatch(await buildEvidenceBatch(selectedOrganization.id, agreement.id, window));
      await reload(selectedOrganization.id, agreement.id);
    }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "Evidence could not be assembled."); }
    finally { setBusy(false); }
  }

  async function downloadEvidence() {
    if (!selectedOrganization || !agreement || !batch) return;
    setBusy(true); setError(null);
    try {
      const data = await exportEvidenceBatch(selectedOrganization.id, agreement.id, batch.id);
      const result = data as { anchor?: { status: string; chainId: number | null; transactionHash: string | null } | null; verification?: { valid: boolean } };
      if (!result.verification?.valid) throw new Error("The evidence package failed its integrity verification.");
      setBatch((current) => current ? { ...current, anchorIntent: result.anchor ? { status: result.anchor.status, transactionChainId: result.anchor.chainId, transactionHash: result.anchor.transactionHash } : null, verification: { ...current.verification, independentlyVerifiable: Boolean(result.verification?.valid) } } : current);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `sla-dex-evidence-${batch.id}.json`; link.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "Evidence export failed."); }
    finally { setBusy(false); }
  }

  return <>
    <PageTitle title="Live monitoring" subtitle="Measurements and evidence are bound to an immutable, bilaterally signed agreement version." />
    <div className="mb-5 flex flex-wrap items-center gap-2"><Status tone="green">LIVE DATA</Status><span className="text-xs text-muted">A breach candidate is an automated signal, not an adjudication.</span></div>
    {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-white p-4 text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-white p-4 text-sm text-emerald-800">{notice}</p>}
    {!agreements.length && <section className="rounded-xl border border-border bg-white p-6"><h2 className="font-semibold">No confirmed agreements</h2><p className="mt-2 text-sm text-muted">Monitoring starts after both parties sign and the current agreement version is confirmed on the configured network.</p></section>}
    {agreements.length > 0 && <>
      <section className="mb-5 flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border bg-white p-4 sm:p-5">
        <label className="grid gap-2 text-xs font-medium text-muted">Confirmed agreement<select aria-label="Confirmed agreement" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setBatch(null); setEvaluationWindow(null); }} className="min-w-64 rounded-lg border border-border px-3 py-2 text-sm text-ink">{agreements.map((item) => <option key={item.id} value={item.id}>{item.reference} · {item.name} · v{item.version}</option>)}</select></label>
        {agreement && <p className="text-xs text-muted">Signed targets: {agreement.terms.uptimeTargetPercent}% uptime · {agreement.terms.responseTimeTargetMs} ms response · {agreement.terms.measurementWindowHours} hour window</p>}
      </section>
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <section className="rounded-xl border border-border bg-white p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Measurement sources</h2><p className="mt-1 text-xs text-muted">Source category reflects who collected or reported the measurement.</p></div><span className="text-xs text-muted">{sources.length} configured</span></div>
          <div className="mt-4 space-y-2">{sources.map((source) => <article key={source.id} className="rounded-lg border border-border p-3"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-medium">{source.name}</p><Status tone={source.trustCategory === "PROVIDER_REPORTED" ? "blue" : "green"}>{source.trustCategory.replaceAll("_", " ")}</Status></div><p className="mt-1 break-all text-xs text-muted">{source.type.replaceAll("_", " ")} · every {source.intervalSeconds}s · {source.enabled ? "active" : "paused"}{source.endpointUrl ? ` · ${source.endpointUrl}` : ""}</p>{selectedOrganization?.role !== "MEMBER" && <div className="mt-2 flex flex-wrap gap-2"><button disabled={busy} onClick={() => void updateSource(source, { enabled: !source.enabled })} className="rounded border border-border px-2 py-1 text-[11px] font-semibold">{source.enabled ? "Pause" : "Resume"}</button>{source.type === "SIGNED_WEBHOOK" && <button disabled={busy} onClick={() => void updateSource(source, { rotateWebhookSecret: true })} className="rounded border border-border px-2 py-1 text-[11px] font-semibold">Rotate secret</button>}</div>}</article>)}{sources.length === 0 && <p className="rounded-lg bg-canvas p-4 text-sm text-muted">No sources yet.</p>}</div>
          {selectedOrganization?.role !== "MEMBER" && <form onSubmit={addSource} className="mt-5 grid gap-3 border-t border-border pt-4"><h3 className="text-sm font-semibold">Add monitoring source</h3><label className="grid gap-1 text-xs text-muted">Source type<select value={sourceType} onChange={(event) => setSourceType(event.target.value as MonitoringSource["type"])} className="w-fit rounded-lg border border-border px-3 py-2 text-sm text-ink"><option value="HTTP_PROBE">Server HTTP probe</option><option value="SIGNED_WEBHOOK">Signed provider webhook</option></select></label><label className="grid gap-1 text-xs text-muted">Source name<input required maxLength={120} value={sourceName} onChange={(event) => setSourceName(event.target.value)} className="rounded-lg border border-border px-3 py-2 text-sm text-ink" /></label>{sourceType === "HTTP_PROBE" ? <label className="grid gap-1 text-xs text-muted">Public HTTP or HTTPS endpoint<input required type="url" value={endpointUrl} onChange={(event) => setEndpointUrl(event.target.value)} placeholder="https://status.example.com/health" className="rounded-lg border border-border px-3 py-2 text-sm text-ink" /></label> : <p className="rounded-lg bg-canvas p-3 text-xs leading-5 text-muted">The generated webhook secret is shown once. Submit to <code>/api/v1/monitoring/webhooks/{"{sourceId}"}</code> with signed timestamp, nonce, event ID, and raw-body HMAC headers.</p>}<label className="grid gap-1 text-xs text-muted">Interval (60–3600 seconds)<input required type="number" min={60} max={3600} step={60} value={intervalSeconds} onChange={(event) => setIntervalSeconds(Number(event.target.value))} className="w-40 rounded-lg border border-border px-3 py-2 text-sm text-ink" /></label><button disabled={busy} className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Add source</button></form>}
        </section>
        <section className="rounded-xl border border-border bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">KPI evaluation</h2><p className="mt-1 text-xs text-muted">Window length comes from signed terms; missing samples reduce coverage.</p></div><button disabled={busy || sources.length === 0} onClick={() => void evaluate()} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50">Evaluate signed window</button></div>
          {comparableEvaluations.length > 1 && <p className="mt-3 rounded-lg bg-canvas p-3 text-xs text-muted">Latest matching window · cross-source range: {sourceRange.uptime === null ? "uptime unavailable" : `${sourceRange.uptime.toFixed(2)} percentage points uptime`} · {sourceRange.latency === null ? "latency unavailable" : `${sourceRange.latency.toFixed(2)} ms mean latency difference`}. Differences are shown for review and do not imply manipulation.</p>}
          <div className="mt-4 space-y-2">{evaluations.map((item) => <article key={item.id} className="rounded-lg border border-border p-3"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-medium">{item.source.name}</p><Status tone={item.state === "BREACH_CANDIDATE" ? "red" : item.state === "HEALTHY" ? "green" : "amber"}>{item.state.replaceAll("_", " ")}</Status></div><p className="mt-2 text-xs text-muted">Uptime {item.uptimePercent === null ? "unknown" : `${item.uptimePercent}%`} · mean latency {item.meanLatencyMs === null ? "unknown" : `${item.meanLatencyMs} ms`} · coverage {item.coveragePercent}% · unknown samples {item.unknownObservations}</p><p className="mt-1 text-[11px] text-muted">{item.algorithmVersion} · {item.source.trustCategory.replaceAll("_", " ")}</p></article>)}{evaluations.length === 0 && <p className="rounded-lg bg-canvas p-4 text-sm text-muted">Run an evaluation to see source-by-source results.</p>}</div>
          <div className="mt-5 border-t border-border pt-4"><h3 className="text-sm font-semibold">Potential breaches</h3>{breaches.length ? <ul className="mt-2 space-y-2">{breaches.map((item) => <li key={item.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs"><p className="font-semibold">{item.evaluation.source.name} · {item.state.replaceAll("_", " ")}</p><p className="mt-1 text-amber-900">{item.summary}</p></li>)}</ul> : <p className="mt-2 text-xs text-muted">No breach candidates recorded.</p>}</div>
          <div className="mt-5 border-t border-border pt-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Evidence package</h3><p className="mt-1 text-xs text-muted">Includes normalized measurement records, Merkle root, and inclusion proofs.</p></div><button disabled={busy || observations.length === 0} onClick={() => void createEvidence()} className="rounded-lg bg-nav px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Build evidence</button></div>{batch && <div className="mt-3 rounded-lg bg-canvas p-3"><p className="text-xs font-semibold">Version {batch.agreementVersion} · {batch.observationCount} observations</p><code className="mt-2 block break-all font-mono text-[10px] text-muted">Merkle root {batch.merkleRoot}</code><code className="mt-1 block break-all font-mono text-[10px] text-muted">Batch digest {batch.batchDigest}</code><div className="mt-3 flex flex-wrap items-center gap-2"><button onClick={() => void downloadEvidence()} disabled={busy} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold">Export & verify</button>{batch.verification.independentlyVerifiable && <Status tone="green">Integrity check passed</Status>}<Status tone={batch.anchorIntent?.status === "CONFIRMED" ? "green" : batch.anchorIntent?.status === "FAILED" ? "red" : "amber"}>{batch.anchorIntent?.status ?? "ANCHOR PENDING"}</Status>{batch.anchorIntent?.transactionHash && <code className="break-all font-mono text-[10px] text-muted">{batch.anchorIntent.transactionHash}</code>}</div></div>}</div>
        </section>
      </div>
      <section className="mt-5 overflow-hidden rounded-xl border border-border bg-white"><div className="border-b border-border p-5"><h2 className="font-semibold">Observation history</h2><p className="mt-1 text-xs text-muted">Showing {observations.length} latest records · raw provider payloads are not displayed.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead><tr className="bg-canvas text-muted"><th className="px-4 py-3">Observed</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Trust</th><th className="px-4 py-3">Reachable</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Latency</th><th className="px-4 py-3">Validity</th></tr></thead><tbody>{observations.map((row) => <tr key={row.id} className="border-t border-border"><td className="px-4 py-3">{new Date(row.observedAt).toLocaleString()}</td><td className="px-4 py-3">{row.source.name}</td><td className="px-4 py-3">{row.trustCategory.replaceAll("_", " ")}</td><td className="px-4 py-3">{row.reachable === null ? "Unknown" : row.reachable ? "Yes" : "No"}</td><td className="px-4 py-3">{row.httpStatus ?? row.errorCategory ?? "—"}</td><td className="px-4 py-3">{row.latencyMs === null ? "—" : `${row.latencyMs} ms`}</td><td className="px-4 py-3">{row.validity}</td></tr>)}</tbody></table></div>{observations.length === 0 && <p className="p-5 text-sm text-muted">No observations collected in this version yet.</p>}</section>
    </>}
  </>;
}

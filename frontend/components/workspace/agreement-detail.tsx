"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageTitle, Status } from "@/components/ui";
import { AgreementEditor } from "@/components/workspace/agreement-editor";
import { AgreementLifecyclePanel } from "@/components/workspace/agreement-lifecycle-panel";
import { amendAgreement, ApiError, cancelAgreement, getAgreement, listAgreementVersions, updateAgreement, type AgreementVersion, type LiveAgreement } from "@/lib/live-api";
import { useWorkspace } from "./workspace-context";

export function LiveAgreementDetail({ id }: { id: string }) {
  const { selectedOrganization, session } = useWorkspace();
  if (!selectedOrganization) return <p role="status" className="rounded-xl border border-border bg-white p-6 text-sm text-muted">Loading organization…</p>;
  return <LiveAgreementDetailForOrganization key={`${selectedOrganization.id}-${id}`} id={id} organizationId={selectedOrganization.id} organizationName={selectedOrganization.name} role={selectedOrganization.role} userId={session?.user.id ?? ""} />;
}

function LiveAgreementDetailForOrganization({ id, organizationId, organizationName, role, userId }: { id: string; organizationId: string; organizationName: string; role: "OWNER" | "ADMIN" | "MEMBER"; userId: string }) {
  const [agreement, setAgreement] = useState<LiveAgreement | null>(null);
  const [versions, setVersions] = useState<AgreementVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [editingAmendment, setEditingAmendment] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      getAgreement(organizationId, id),
      listAgreementVersions(organizationId, id)
    ]).then(([record, history]) => {
      if (active) {
        setAgreement(record);
        setVersions(history);
      }
    }).catch((cause) => {
      if (active) setError(cause instanceof ApiError ? cause.message : "Agreement details could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [id, organizationId]);

  const refreshAgreement = useCallback(async () => {
    const record = await getAgreement(organizationId, id);
    setAgreement(record);
    setVersions(await listAgreementVersions(organizationId, id));
  }, [id, organizationId]);

  async function save(input: Parameters<typeof updateAgreement>[3]) {
    if (!agreement) return;
    const updated = agreement.status === "DRAFT"
      ? await updateAgreement(organizationId, agreement.id, agreement.version, input)
      : await amendAgreement(organizationId, agreement.id, agreement.version, input);
    setAgreement(updated);
    setEditingAmendment(false);
    setSaveNotice(agreement.status === "DRAFT" ? `Saved version ${updated.version}.` : `Created version ${updated.version}. The prior approval no longer applies.`);
    setHistoryError(null);
    try {
      setVersions(await listAgreementVersions(organizationId, agreement.id));
    } catch {
      setHistoryError("The draft was saved, but its version history could not be refreshed.");
    }
  }

  async function cancelCurrentAgreement() {
    if (!agreement || !window.confirm("Cancel this agreement before blockchain registration? This action cannot be undone.")) return;
    try {
      const cancelled = await cancelAgreement(organizationId, agreement.id, agreement.version);
      setAgreement(cancelled);
      setSaveNotice("Agreement cancelled.");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The agreement could not be cancelled.");
    }
  }

  if (loading) return <p role="status" className="surface-card rounded-xl border p-6 text-sm text-muted">Loading draft…</p>;
  if (error || !agreement) return <section role="alert" className="surface-card rounded-xl border border-zinc-400 p-5"><p className="text-sm text-danger">{error ?? "Agreement not found."}</p><Link href="/workspace/agreements" className="mt-3 inline-block text-sm font-semibold text-brand">Back to live agreements</Link></section>;

  const readOnly = role === "MEMBER";
  return <>
    <PageTitle title={agreement.name} subtitle={`${agreement.reference} · ${agreement.ownerOrganizationId === organizationId ? `Owned by ${organizationName}` : "Shared with your organization"}`} action={<Link href="/workspace/agreements" className="text-sm font-semibold text-brand">All agreements</Link>} />
    <div className="mb-5 flex items-center gap-2"><Status tone="blue">LIVE DATA</Status><Status tone={agreement.status === "ANCHOR_CONFIRMED" ? "green" : agreement.status === "ANCHOR_FAILED" || agreement.status === "REJECTED" || agreement.status === "CANCELLED" ? "red" : "amber"}>{agreement.status.replaceAll("_", " ")}</Status><span className="text-xs text-muted">Terms and workflow state come from the live API.</span></div>
    {saveNotice && <p role="status" className="mb-4 text-sm text-success">{saveNotice}</p>}
    {readOnly && <p className="surface-card mb-4 rounded-lg border p-3 text-sm text-muted">Your organization role is read-only for approval and agreement changes.</p>}
    {agreement.ownerOrganizationId === organizationId && agreement.status === "DRAFT" && <AgreementEditor key={`${agreement.id}-${agreement.version}`} agreement={agreement} readOnly={readOnly} submitLabel="Save draft" onSave={save} />}
    {agreement.ownerOrganizationId === organizationId && editingAmendment && <AgreementEditor key={`${agreement.id}-${agreement.version}-amendment`} agreement={agreement} readOnly={readOnly} submitLabel="Create new version" onSave={save} />}
    {agreement.ownerOrganizationId === organizationId && role !== "MEMBER" && !editingAmendment && ["AWAITING_COUNTERPARTY", "AWAITING_SIGNATURES", "ANCHOR_FAILED", "ANCHOR_CONFIRMED", "REJECTED"].includes(agreement.status) && <div className="mb-4 flex flex-wrap gap-2"><button type="button" onClick={() => setEditingAmendment(true)} className="rounded-lg border border-border bg-white/80 px-3 py-2 text-sm font-semibold">Amend terms</button>{["AWAITING_COUNTERPARTY", "AWAITING_SIGNATURES", "ANCHOR_FAILED"].includes(agreement.status) && <button type="button" onClick={() => void cancelCurrentAgreement()} className="rounded-lg border border-zinc-400 bg-white/80 px-3 py-2 text-sm font-semibold text-danger hover:border-zinc-900">Cancel agreement</button>}</div>}
    {agreement.ownerOrganizationId === organizationId && editingAmendment && <button type="button" onClick={() => setEditingAmendment(false)} className="mt-2 text-sm font-semibold text-muted">Discard amendment edits</button>}
    {agreement.status !== "DRAFT" && <section aria-label="Agreement terms" className="surface-card mt-6 rounded-xl border p-5 sm:p-6">
      <h2 className="text-base font-semibold">Agreement terms</h2>
      <p className="mt-1 text-xs text-muted">Version {agreement.version}</p>
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
        <div className="min-w-0 sm:col-span-3"><dt className="text-xs text-muted">Service description</dt><dd className="mt-1 whitespace-pre-wrap break-words">{agreement.serviceDescription}</dd></div>
        <div><dt className="text-xs text-muted">Uptime target</dt><dd className="mt-1">{agreement.terms.uptimeTargetPercent}%</dd></div>
        <div><dt className="text-xs text-muted">Response target</dt><dd className="mt-1">{agreement.terms.responseTimeTargetMs} ms</dd></div>
        <div><dt className="text-xs text-muted">Measurement window</dt><dd className="mt-1">{agreement.terms.measurementWindowHours} hours</dd></div>
        <div className="min-w-0 sm:col-span-3"><dt className="text-xs text-muted">Exclusions</dt><dd className="mt-1">{agreement.terms.exclusions.length > 0 ? <ul className="list-inside list-disc space-y-1 break-words">{agreement.terms.exclusions.map((exclusion, index) => <li key={index}>{exclusion}</li>)}</ul> : "None"}</dd></div>
        {agreement.terms.notes && <div className="min-w-0 sm:col-span-3"><dt className="text-xs text-muted">Notes</dt><dd className="mt-1 whitespace-pre-wrap break-words">{agreement.terms.notes}</dd></div>}
      </dl>
    </section>}
    <AgreementLifecyclePanel key={`${agreement.id}-${agreement.version}`} agreement={agreement} organizationId={organizationId} userId={userId} canApprove={role !== "MEMBER"} onRefreshAgreement={refreshAgreement} />
    <section className="surface-card mt-7 rounded-xl border p-5 sm:p-6">
      <h2 className="text-base font-semibold">Version history</h2>
      {historyError && <p role="alert" className="mt-3 text-sm text-danger">{historyError}</p>}
      <ol className="mt-4 divide-y divide-border">
        {versions.map((version) => <li key={version.version} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
          <div><p className="text-sm font-semibold">Version {version.version} · {version.name}</p><p className="mt-1 text-xs text-muted">Saved by {version.actor.displayName} · {new Date(version.createdAt).toLocaleString()}</p></div>
          <span className="text-xs text-muted">{version.terms.uptimeTargetPercent}% uptime · {version.terms.responseTimeTargetMs} ms</span>
        </li>)}
      </ol>
    </section>
  </>;
}

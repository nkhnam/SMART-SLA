"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageTitle, Status } from "@/components/ui";
import { AgreementEditor } from "@/components/workspace/agreement-editor";
import { ApiError, getAgreement, listAgreementVersions, updateAgreement, type AgreementVersion, type LiveAgreement } from "@/lib/live-api";
import { useWorkspace } from "./workspace-context";

export function LiveAgreementDetail({ id }: { id: string }) {
  const { selectedOrganization } = useWorkspace();
  if (!selectedOrganization) return <p role="status" className="rounded-xl border border-border bg-white p-6 text-sm text-muted">Loading organization…</p>;
  return <LiveAgreementDetailForOrganization key={`${selectedOrganization.id}-${id}`} id={id} organizationId={selectedOrganization.id} organizationName={selectedOrganization.name} role={selectedOrganization.role} />;
}

function LiveAgreementDetailForOrganization({ id, organizationId, organizationName, role }: { id: string; organizationId: string; organizationName: string; role: "OWNER" | "ADMIN" | "MEMBER" }) {
  const [agreement, setAgreement] = useState<LiveAgreement | null>(null);
  const [versions, setVersions] = useState<AgreementVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

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

  async function save(input: Parameters<typeof updateAgreement>[3]) {
    if (!agreement) return;
    const updated = await updateAgreement(organizationId, agreement.id, agreement.version, input);
    setAgreement(updated);
    setSaveNotice(`Saved version ${updated.version}.`);
    setHistoryError(null);
    try {
      setVersions(await listAgreementVersions(organizationId, agreement.id));
    } catch {
      setHistoryError("The draft was saved, but its version history could not be refreshed.");
    }
  }

  if (loading) return <p role="status" className="rounded-xl border border-border bg-white p-6 text-sm text-muted">Loading draft…</p>;
  if (error || !agreement) return <section role="alert" className="rounded-xl border border-red-200 bg-white p-5"><p className="text-sm text-danger">{error ?? "Agreement not found."}</p><Link href="/workspace/agreements" className="mt-3 inline-block text-sm font-semibold text-brand">Back to live agreements</Link></section>;

  const readOnly = role === "MEMBER";
  return <>
    <PageTitle title={agreement.name} subtitle={`${agreement.reference} · Draft owned by ${organizationName}`} action={<Link href="/workspace/agreements" className="text-sm font-semibold text-brand">All drafts</Link>} />
    <div className="mb-5 flex items-center gap-2"><Status tone="blue">LIVE DATA</Status><span className="text-xs text-muted">Counterparty display names are unverified.</span></div>
    {saveNotice && <p role="status" className="mb-4 text-sm text-success">{saveNotice}</p>}
    {readOnly && <p className="mb-4 rounded-lg border border-border bg-white p-3 text-sm text-muted">Your organization role is read-only for agreement changes.</p>}
    <AgreementEditor key={`${agreement.id}-${agreement.version}`} agreement={agreement} readOnly={readOnly} submitLabel="Save new version" onSave={save} />
    <section className="mt-7 rounded-xl border border-border bg-white p-5 sm:p-6">
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

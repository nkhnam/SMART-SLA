"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ActionLink, PageTitle, Status } from "@/components/ui";
import { toAgreementListItem } from "@/lib/agreement-mapping";
import { ApiError, listAgreements, type AgreementList } from "@/lib/live-api";
import { useWorkspace } from "./workspace-context";

export function LiveAgreementsList() {
  const { selectedOrganization } = useWorkspace();
  if (!selectedOrganization) return <p role="status" className="rounded-xl border border-border bg-white p-6 text-sm text-muted">Loading organization…</p>;
  return <LiveAgreementsListForOrganization key={selectedOrganization.id} organizationId={selectedOrganization.id} canWrite={selectedOrganization.role !== "MEMBER"} />;
}

function LiveAgreementsListForOrganization({ organizationId, canWrite }: { organizationId: string; canWrite: boolean }) {
  const [result, setResult] = useState<AgreementList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listAgreements(organizationId).then((response) => {
      if (active) setResult(response);
    }).catch((cause) => {
      if (active) setError(cause instanceof ApiError ? cause.message : "Agreements could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [organizationId]);

  return <>
    <PageTitle title="Live draft agreements" subtitle="Persisted drafts owned by your selected organization." action={canWrite ? <ActionLink href="/workspace/agreements/new">Create draft</ActionLink> : undefined} />
    <div className="mb-5 flex items-center gap-2 text-xs"><Status tone="blue">LIVE DATA</Status><span className="text-muted">Database-backed · organization-scoped</span></div>
    {loading && <p role="status" className="rounded-xl border border-border bg-white p-6 text-sm text-muted">Loading agreements…</p>}
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-white p-5 text-sm text-danger">{error}</p>}
    {!loading && !error && result?.data.length === 0 && <section className="rounded-xl border border-border bg-white p-8 text-center">
      <h2 className="text-base font-semibold">No draft agreements yet</h2>
      <p className="mt-2 text-sm text-muted">Create a draft to save service terms for this organization.</p>
      {canWrite && <Link href="/workspace/agreements/new" className="mt-5 inline-flex rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white">Create draft</Link>}
    </section>}
    {!loading && !error && result && result.data.length > 0 && <div className="overflow-x-auto rounded-xl border border-border bg-white">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead><tr className="border-b border-border text-xs text-muted"><th className="px-5 py-3 font-medium">Agreement</th><th className="px-5 py-3 font-medium">Counterparty</th><th className="px-5 py-3 font-medium">Uptime target</th><th className="px-5 py-3 font-medium">Response target</th><th className="px-5 py-3 font-medium">Version</th><th className="px-5 py-3 font-medium">Status</th></tr></thead>
        <tbody>{result.data.map((agreement) => {
          const row = toAgreementListItem(agreement);
          return <tr key={row.id} className="border-b border-border/70 last:border-0">
            <td className="px-5 py-4"><Link href={`/workspace/agreements/${row.id}`} className="font-semibold hover:text-brand">{row.name}</Link><p className="mt-1 font-mono text-xs text-muted">{row.reference}</p></td>
            <td className="px-5 py-4">{row.counterparty}</td><td className="px-5 py-4">{row.uptimeTarget}</td><td className="px-5 py-4">{row.responseTarget}</td><td className="px-5 py-4">{row.versionLabel}</td><td className="px-5 py-4"><Status tone="blue">DRAFT</Status></td>
          </tr>;
        })}</tbody>
      </table>
      <p className="border-t border-border px-5 py-3 text-xs text-muted">Showing {result.data.length} of {result.total} drafts</p>
    </div>}
  </>;
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionLink, PageTitle, Status } from "@/components/ui";
import { toAgreementListItem } from "@/lib/agreement-mapping";
import { ApiError, decideAgreementInvitation, listAgreementInvitations, listAgreements, type AgreementInvitation, type AgreementList } from "@/lib/live-api";
import { useWorkspace } from "./workspace-context";

export function LiveAgreementsList() {
  const { selectedOrganization } = useWorkspace();
  if (!selectedOrganization) return <p role="status" className="rounded-xl border border-border bg-white p-6 text-sm text-muted">Loading organization…</p>;
  return <LiveAgreementsListForOrganization key={selectedOrganization.id} organizationId={selectedOrganization.id} canWrite={selectedOrganization.role !== "MEMBER"} />;
}

function LiveAgreementsListForOrganization({ organizationId, canWrite }: { organizationId: string; canWrite: boolean }) {
  const router = useRouter();
  const [result, setResult] = useState<AgreementList | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<AgreementInvitation[]>([]);
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const [pendingInvitationId, setPendingInvitationId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listAgreements(organizationId, page).then((response) => {
      if (active) setResult(response);
    }).catch((cause) => {
      if (active) setError(cause instanceof ApiError ? cause.message : "Agreements could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    listAgreementInvitations(organizationId).then((items) => {
      if (active) setInvitations(items);
    }).catch((cause) => {
      if (active) setInvitationError(cause instanceof ApiError ? cause.message : "Invitations could not be loaded.");
    });
    return () => { active = false; };
  }, [organizationId, page]);

  function showPage(nextPage: number) {
    setLoading(true);
    setError(null);
    setPage(nextPage);
  }

  async function decide(invitation: AgreementInvitation, decision: "accept" | "reject") {
    setPendingInvitationId(invitation.id);
    setInvitationError(null);
    try {
      await decideAgreementInvitation(organizationId, invitation.agreementId, invitation.id, decision);
      setInvitations((current) => current.filter((item) => item.id !== invitation.id));
      if (decision === "accept") router.push(`/workspace/agreements/${invitation.agreementId}`);
    } catch (cause) {
      setInvitationError(cause instanceof ApiError ? cause.message : "The invitation could not be updated.");
    } finally {
      setPendingInvitationId(null);
    }
  }

  return <>
    <PageTitle title="Live agreements" subtitle="Current agreements and invitations for your selected organization." action={canWrite ? <ActionLink href="/workspace/agreements/new">Create draft</ActionLink> : undefined} />
    <div className="mb-5 flex items-center gap-2 text-xs"><Status tone="blue">LIVE DATA</Status><span className="text-muted">Database-backed · organization-scoped</span></div>
    {(invitations.length > 0 || invitationError) && <section className="surface-card mb-6 rounded-xl border p-5 sm:p-6">
      <h2 className="text-base font-semibold">Invitations</h2>
      <p className="mt-1 text-sm text-muted">Review the counterparty organization before opening or approving its terms.</p>
      {invitationError && <p role="alert" className="mt-3 text-sm text-danger">{invitationError}</p>}
      <ul className="mt-3 divide-y divide-border">
        {invitations.map((invitation) => <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
          <div><p className="text-sm font-semibold">{invitation.inviterOrganization.name} invited your organization</p><p className="mt-1 text-xs text-muted">{invitation.agreement.reference} · version {invitation.agreementVersion} · expires {new Date(invitation.expiresAt).toLocaleString()}</p></div>
          <div className="flex gap-2">
            <span className="self-center text-xs text-muted">Terms unlock after acceptance</span>
            {canWrite && <><button type="button" disabled={pendingInvitationId === invitation.id} onClick={() => void decide(invitation, "accept")} className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">Accept</button><button type="button" disabled={pendingInvitationId === invitation.id} onClick={() => void decide(invitation, "reject")} className="rounded-lg border border-border bg-white/75 px-3 py-2 text-xs font-semibold disabled:opacity-60">Reject</button></>}
          </div>
        </li>)}
      </ul>
    </section>}
    {loading && <p role="status" className="surface-card rounded-xl border p-6 text-sm text-muted">Loading agreements…</p>}
    {error && <p role="alert" className="surface-card rounded-xl border border-zinc-400 p-5 text-sm text-danger">{error}</p>}
    {!loading && !error && result?.data.length === 0 && <section className="surface-card rounded-xl border p-8 text-center">
      <h2 className="text-base font-semibold">No draft agreements yet</h2>
      <p className="mt-2 text-sm text-muted">Create a draft to save service terms for this organization.</p>
      {canWrite && <Link href="/workspace/agreements/new" className="mt-5 inline-flex rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white">Create draft</Link>}
    </section>}
    {!loading && !error && result && result.data.length > 0 && <div className="surface-card overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead><tr className="border-b border-border text-xs text-muted"><th className="px-5 py-3 font-medium">Agreement</th><th className="px-5 py-3 font-medium">Counterparty</th><th className="px-5 py-3 font-medium">Uptime target</th><th className="px-5 py-3 font-medium">Response target</th><th className="px-5 py-3 font-medium">Version</th><th className="px-5 py-3 font-medium">Status</th></tr></thead>
        <tbody>{result.data.map((agreement) => {
          const row = toAgreementListItem(agreement);
          return <tr key={row.id} className="border-b border-border/70 last:border-0">
            <td className="px-5 py-4"><Link href={`/workspace/agreements/${row.id}`} className="font-semibold hover:text-brand">{row.name}</Link><p className="mt-1 font-mono text-xs text-muted">{row.reference}</p></td>
            <td className="px-5 py-4">{row.counterparty}</td><td className="px-5 py-4">{row.uptimeTarget}</td><td className="px-5 py-4">{row.responseTarget}</td><td className="px-5 py-4">{row.versionLabel}</td><td className="px-5 py-4"><Status tone={agreement.status === "ANCHOR_CONFIRMED" ? "green" : agreement.status === "ANCHOR_FAILED" || agreement.status === "REJECTED" || agreement.status === "CANCELLED" ? "red" : agreement.status === "DRAFT" ? "neutral" : "amber"}>{agreement.status.replaceAll("_", " ")}</Status></td>
          </tr>;
        })}</tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs">
        <p className="text-muted">Showing {(result.page - 1) * result.pageSize + 1}–{(result.page - 1) * result.pageSize + result.data.length} of {result.total} agreements</p>
        <nav aria-label="Agreement pages" className="flex items-center gap-3">
          <button type="button" disabled={result.page <= 1} onClick={() => showPage(result.page - 1)} className="rounded border border-border px-3 py-1.5 font-semibold disabled:opacity-50">Previous</button>
          <span>Page {result.page}</span>
          <button type="button" disabled={result.page * result.pageSize >= result.total} onClick={() => showPage(result.page + 1)} className="rounded border border-border px-3 py-1.5 font-semibold disabled:opacity-50">Next</button>
        </nav>
      </div>
    </div>}
  </>;
}

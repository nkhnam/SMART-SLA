"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, logout } from "@/lib/live-api";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  return <WorkspaceProvider><WorkspaceFrame>{children}</WorkspaceFrame></WorkspaceProvider>;
}

function WorkspaceFrame({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const workspace = useWorkspace();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<{ organizationId: string; message: string } | null>(null);

  async function copyOrganizationId() {
    const organizationId = workspace.selectedOrganization?.id;
    if (!organizationId) return;
    try {
      await navigator.clipboard.writeText(organizationId);
      setCopyNotice({ organizationId, message: "Organization ID copied." });
    } catch {
      setCopyNotice({ organizationId, message: "Select and copy the organization ID shown above." });
    }
  }

  async function signOut() {
    setLogoutError(null);
    try {
      await logout();
      router.push("/login");
      router.refresh();
    } catch (cause) {
      setLogoutError(cause instanceof ApiError ? cause.message : "Sign out could not be completed.");
    }
  }

  return <div className="min-h-screen bg-canvas">
    <header className="border-b border-border bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <div className="flex items-center gap-5">
          <Link href="/workspace/agreements" className="text-sm font-bold tracking-wide">SLA-DEX <span className="font-medium text-muted">Live workspace</span></Link>
          <nav aria-label="Live workspace navigation" className="flex items-center gap-4 text-xs font-semibold">
            <Link href="/workspace/agreements" className="text-ink hover:text-brand">Agreements</Link>
            <Link href="/workspace/monitoring" className="text-ink hover:text-brand">Monitoring</Link>
            <Link href="/overview" className="text-muted hover:text-brand">Demo Mode</Link>
          </nav>
        </div>
        {workspace.status === "ready" && workspace.session && <div className="flex flex-wrap items-center gap-3">
          {workspace.organizations.length > 0 && <label className="flex items-center gap-2 text-xs text-muted">Organization
            <select aria-label="Live organization" value={workspace.selectedOrganization?.id ?? ""} onChange={(event) => workspace.selectOrganization(event.target.value)} className="rounded-lg border border-border bg-white px-2.5 py-2 text-xs font-medium text-ink">
              {workspace.organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name} · {organization.role}</option>)}
            </select>
          </label>}
          <span className="hidden text-xs text-muted sm:inline">{workspace.session.user.displayName}</span>
          <button type="button" onClick={signOut} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-canvas">Sign out</button>
        </div>}
      </div>
      {workspace.status === "ready" && workspace.selectedOrganization && <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-5 pb-4 text-xs sm:px-8">
        <span className="text-muted">Your organization ID</span>
        <code className="min-w-0 break-all select-all">{workspace.selectedOrganization.id}</code>
        <button type="button" onClick={() => void copyOrganizationId()} className="rounded border border-border px-2 py-1 font-semibold">Copy organization ID</button>
        <span aria-live="polite" className="text-muted">{copyNotice?.organizationId === workspace.selectedOrganization.id ? copyNotice.message : "Share this ID with a counterparty to receive an agreement invitation."}</span>
      </div>}
    </header>
    {logoutError && <p role="alert" className="mx-auto max-w-7xl px-5 pt-4 text-sm text-danger sm:px-8">{logoutError}</p>}
    <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
      {workspace.status === "loading" && <p role="status" className="rounded-xl border border-border bg-white p-6 text-sm text-muted">Checking your session…</p>}
      {workspace.status === "unavailable" && <section role="alert" className="rounded-xl border border-amber-200 bg-white p-6">
        <h1 className="text-lg font-semibold">Live workspace is unavailable</h1>
        <p className="mt-2 text-sm text-muted">{workspace.error}</p>
        <p className="mt-2 text-sm text-muted">Your data has not been replaced with demo records.</p>
        <Link href="/overview" className="mt-4 inline-flex rounded-lg border border-border px-4 py-2.5 text-sm font-semibold">Open Demo Mode</Link>
      </section>}
      {workspace.status === "unauthenticated" && <section className="rounded-xl border border-border bg-white p-6">
        <h1 className="text-lg font-semibold">Sign in to your live workspace</h1>
        <p className="mt-2 text-sm text-muted">Live agreements are private to their owning organization.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/login" className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white">Sign in</Link>
          <Link href="/register" className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold">Create account</Link>
          <Link href="/overview" className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold">Open Demo Mode</Link>
        </div>
      </section>}
      {workspace.status === "ready" && workspace.organizations.length === 0 && <p className="rounded-xl border border-border bg-white p-6 text-sm text-muted">Your account is not a member of an organization.</p>}
      {workspace.status === "ready" && workspace.selectedOrganization && children}
    </main>
  </div>;
}

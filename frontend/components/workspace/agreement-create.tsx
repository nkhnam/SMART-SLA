"use client";

import { useRouter } from "next/navigation";
import { AgreementEditor } from "@/components/workspace/agreement-editor";
import { createAgreement, type AgreementInput } from "@/lib/live-api";
import { useWorkspace } from "./workspace-context";

export function CreateLiveAgreement() {
  const router = useRouter();
  const { selectedOrganization } = useWorkspace();

  async function save(input: AgreementInput) {
    if (!selectedOrganization) return;
    const created = await createAgreement(selectedOrganization.id, input);
    router.push(`/workspace/agreements/${created.id}`);
    router.refresh();
  }

  if (selectedOrganization?.role === "MEMBER") {
    return <p role="alert" className="surface-card rounded-xl border p-5 text-sm text-muted">Your organization role can read drafts but cannot create them.</p>;
  }
  return <>
    <p className="mb-5 text-sm text-muted">The selected organization owns this draft. The counterparty name is informational only.</p>
    <AgreementEditor submitLabel="Save draft" onSave={save} />
  </>;
}

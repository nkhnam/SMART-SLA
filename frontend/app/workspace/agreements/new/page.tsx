import Link from "next/link";
import { PageTitle } from "@/components/ui";
import { CreateLiveAgreement } from "@/components/workspace/agreement-create";

export default function NewLiveAgreementPage() {
  return <>
    <PageTitle title="Create a draft agreement" subtitle="Save a structured SLA draft for your selected organization." action={<Link href="/workspace/agreements" className="text-sm font-semibold text-brand">Back to agreements</Link>} />
    <CreateLiveAgreement />
  </>;
}

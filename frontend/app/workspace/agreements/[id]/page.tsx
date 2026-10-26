import { LiveAgreementDetail } from "@/components/workspace/agreement-detail";

export default async function LiveAgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LiveAgreementDetail id={id} />;
}

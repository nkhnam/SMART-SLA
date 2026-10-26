import { SEVERITY_CLS, type Severity } from "@/lib/terms"

export default function SeverityBadge({ severity }: { severity: Severity | null | undefined }) {
  if (!severity) return null
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${SEVERITY_CLS[severity]}`}>
      {severity}
    </span>
  )
}

"use client"

import { useState } from "react"
import { ShieldCheck, ShieldAlert } from "lucide-react"
import { api } from "@/lib/api"
import { Btn, PARTY_LABEL, fmtDateTime, shortHash } from "@/components/sla/ui"

type VerifyResult = {
  ok: boolean
  verdict: string
  storedHash?: string | null
  recomputedHash?: string
  checks?: Record<string, boolean> | null
  signatures?: { party: "BUYER" | "SUPPLIER"; method: string | null; signer: string | null; signedAt: string | null; signatureValid: boolean; signedCurrentTerms: boolean }[]
  links?: Record<string, string | null>
}

const CHECK_LABEL: Record<string, string> = {
  hashMatchesDatabase: "Hash khớp dữ liệu",
  existsOnChain: "Có trên blockchain",
  slaHashMatches: "Đúng hợp đồng",
  creditMatches: "Đúng mức hoàn phí",
  statusMatches: "Đúng trạng thái",
}

// Nút "Kiểm chứng": tính lại hash từ dữ liệu và đối chiếu với Polygon (ai cũng tự làm được)
export default function VerifyButton({ path, label = "Kiểm chứng" }: { path: string; label?: string }) {
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      setResult(await api<VerifyResult>(path))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không kiểm chứng được")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <Btn variant="ghost" onClick={run} loading={busy}>
        <ShieldCheck className="h-4 w-4" /> {label}
      </Btn>
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      {result && (
        <div className={`mt-3 rounded-xl border p-4 text-sm ${result.ok ? "border-emerald-500/40 bg-emerald-500/10" : "border-amber-500/40 bg-amber-500/10"}`} role="status">
          <p className="flex items-start gap-2 font-semibold text-white">
            {result.ok ? <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-300" /> : <ShieldAlert className="mt-0.5 h-4 w-4 text-amber-300" />}
            {result.verdict}
          </p>
          <dl className="mt-3 grid gap-1 text-xs text-slate-300">
            {result.recomputedHash && <div><dt className="inline text-slate-500">Hash tính lại: </dt><dd className="inline font-mono">{shortHash(result.recomputedHash)}</dd></div>}
            {result.checks && Object.entries(result.checks).map(([k, v]) => (
              <div key={k}>{v ? "✓" : "✗"} {CHECK_LABEL[k] ?? k}</div>
            ))}
            {result.signatures?.map((s) => (
              <div key={s.party}>
                {s.signatureValid && s.signedCurrentTerms ? "✓" : "✗"} Chữ ký {PARTY_LABEL[s.party].toLowerCase()} ({s.method === "OTP_EMAIL" ? "OTP email" : "ví"} {s.signer}) lúc {fmtDateTime(s.signedAt)}
                {!s.signedCurrentTerms && " — điều khoản đã thay đổi sau khi ký"}
              </div>
            ))}
          </dl>
          {result.links && (
            <div className="mt-3 flex flex-wrap gap-3 text-xs">
              {Object.entries(result.links).filter(([, url]) => url).map(([k, url]) => (
                <a key={k} href={url!} target="_blank" rel="noreferrer" className="font-semibold text-blue-300 hover:text-blue-200">Xem trên Polygonscan ({k})</a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

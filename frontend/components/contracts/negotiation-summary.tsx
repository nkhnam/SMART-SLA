"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Sparkles, X } from "lucide-react"
import { api } from "@/lib/api"
import { Badge, Btn, ErrorNote, fmtDateTime } from "@/components/sla/ui"

type Summary = {
  overview: string
  recommendation: "Có thể ký sau khi kiểm tra" | "Cần bàn bạc thêm" | "Cân nhắc từ chối"
  agreedChanges: string[]
  agreedConditions: string[]
  pending: string[]
  messageCount: number
  truncated: boolean
  generatedAt: string
}

const TONE = { "Có thể ký sau khi kiểm tra": "green", "Cần bàn bạc thêm": "amber", "Cân nhắc từ chối": "red" } as const

function List({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <p className="text-xs font-bold text-slate-300">{title}</p>
      {items.length ? (
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-200">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
      ) : (
        <p className="mt-1 text-xs text-slate-500">{empty}</p>
      )}
    </div>
  )
}

// Tóm tắt luồng bàn bạc bằng AI (chạy ở backend). Chỉ là gợi ý: muốn áp dụng phải sửa điều khoản và ký lại.
export default function NegotiationSummary({ contractId, contractStatus }: { contractId: string; contractStatus?: string }) {
  const [enabled, setEnabled] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<{ enabled: boolean }>("/api/negotiation-summary/enabled").then((r) => setEnabled(r.enabled)).catch(() => setEnabled(false))
  }, [])

  useEffect(() => {
    // Đổi hợp đồng -> bỏ bản tóm tắt cũ
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSummary(null)
    setError(null)
  }, [contractId])

  if (!enabled) return null

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      setSummary(await api<Summary>(`/api/contracts/${contractId}/negotiation-summary`, { method: "POST", timeoutMs: 60_000 }))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tóm tắt được")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4">
      {!summary && (
        <div className="flex flex-wrap items-center gap-3">
          <Btn variant="ghost" onClick={run} loading={busy}><Sparkles className="h-4 w-4 text-violet-300" />Tóm tắt bằng AI</Btn>
          <span className="text-[11px] text-slate-500">Nội dung bàn bạc được gửi tới dịch vụ AI (Google Gemini) để tóm tắt.</span>
        </div>
      )}
      <div className="mt-2"><ErrorNote message={error} /></div>
      {summary && (
        <section className="rounded-xl border border-violet-500/40 bg-violet-500/[.06] p-4" aria-label="Tóm tắt bàn bạc">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-bold text-white"><Sparkles className="h-4 w-4 text-violet-300" />Tóm tắt bàn bạc</p>
            <div className="flex items-center gap-2">
              <Badge tone={TONE[summary.recommendation]}>Gợi ý: {summary.recommendation}</Badge>
              <button type="button" onClick={() => setSummary(null)} className="text-slate-400 hover:text-white" aria-label="Đóng tóm tắt"><X className="h-4 w-4" /></button>
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-200">{summary.overview}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <List title="Thay đổi KPI hai bên đã đồng ý" items={summary.agreedChanges} empty="Chưa có" />
            <List title="Điều kiện bổ sung đã đồng ý" items={summary.agreedConditions} empty="Chưa có" />
            <List title="Còn đang bàn" items={summary.pending} empty="Không còn điểm nào" />
          </div>
          <p className="mt-4 text-[11px] leading-5 text-slate-500">
            AI chỉ tóm tắt và gợi ý, có thể sai; không phải tư vấn pháp lý. Dựa trên {summary.messageCount} tin nhắn{summary.truncated ? " gần nhất" : ""}, lúc {fmtDateTime(summary.generatedAt)}.
            {contractStatus === "PENDING_SIGNATURE" && (
              <> Muốn áp dụng, mở <Link href={`/contracts/${contractId}`} className="font-semibold text-blue-300 hover:text-blue-200">trang hợp đồng</Link> → <strong className="text-slate-300">Sửa điều khoản</strong>, rồi hai bên ký lại.</>
            )}
          </p>
          <Btn variant="ghost" className="mt-3" onClick={run} loading={busy}>Tóm tắt lại</Btn>
        </section>
      )}
    </div>
  )
}

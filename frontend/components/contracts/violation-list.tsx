"use client"

import Link from "next/link"
import { useState } from "react"
import { api, polygonscanTx } from "@/lib/api"
import type { Violation } from "@/lib/types"
import VerifyButton from "@/components/contracts/verify-button"
import { Btn, Countdown, Empty, ErrorNote, PARTY_LABEL, StatusBadge, fmtDateTime, fmtPercent, inputCls } from "@/components/sla/ui"

const KPI_UNIT: Record<string, string> = { UPTIME: "%", RESPONSE_TIME: "ms", FIRST_RESPONSE: "%", RESOLUTION_TIME: "%", INCIDENT_RESPONSE: " phút" }
const KPI_NAME: Record<string, string> = { UPTIME: "Uptime", RESPONSE_TIME: "Thời gian phản hồi", FIRST_RESPONSE: "Tỷ lệ ticket phản hồi đúng hạn", RESOLUTION_TIME: "Tỷ lệ ticket xử lý đúng hạn", INCIDENT_RESPONSE: "Ứng phó sự cố" }

function ViolationCard({ v, canChallenge, onChanged }: { v: Violation; canChallenge: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now] = useState(() => Date.now())
  const unit = KPI_UNIT[v.kpiCode] ?? ""
  const isOpen = v.status === "PENDING" && new Date(v.challengeDeadline).getTime() > now

  const challenge = async () => {
    setBusy(true)
    setError(null)
    try {
      await api(`/api/violations/${v.id}/challenge`, { method: "POST", body: { reason } })
      setOpen(false)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không gửi được phản đối")
    } finally {
      setBusy(false)
    }
  }

  const txLinks = [
    ["Ghi bằng chứng", v.recordTxHash],
    ["Phản đối", v.challengeTxHash],
    ["Chốt", v.settleTxHash],
  ].filter(([, h]) => h) as [string, string][]

  return (
    <article className="rounded-xl border border-slate-700/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/contracts/${v.contractId}`} className="font-mono text-sm font-bold text-blue-300 hover:text-blue-200">{v.contract.contractCode}</Link>
          <p className="text-xs text-slate-400">{v.contract.serviceName}</p>
        </div>
        <StatusBadge status={v.status} kind="violation" />
      </div>
      <p className="mt-3 text-sm text-slate-200">
        {KPI_NAME[v.kpiCode] ?? v.kpiCode}: đo được <strong className="text-white">{v.actualValue}{unit}</strong>, cam kết {v.targetValue}{unit}. Đề xuất hoàn <strong className="text-white">{fmtPercent(v.creditBps)}</strong> phí.
      </p>
      <p className="mt-1 text-xs text-slate-400">
        Phát hiện lúc {fmtDateTime(v.createdAt)}
        {isOpen && (<> · Tự chốt sau <Countdown deadline={v.challengeDeadline} /></>)}
      </p>
      {v.challengeReason && (
        <p className="mt-2 rounded-lg bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
          {v.challengedBy ? PARTY_LABEL[v.challengedBy] : "Một bên"} phản đối: “{v.challengeReason}”
        </p>
      )}
      {v.resolutionNote && <p className="mt-2 rounded-lg bg-slate-500/10 px-3 py-2 text-xs text-slate-300">Admin SLA-DEX: {v.resolutionNote}</p>}

      {txLinks.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          {txLinks.map(([label, h]) => (
            <a key={label} href={polygonscanTx(h)!} target="_blank" rel="noreferrer" className="font-semibold text-blue-300 hover:text-blue-200">{label} trên Polygonscan</a>
          ))}
        </div>
      )}
      {!v.recordTxHash && v.status === "PENDING" && <p className="mt-2 text-xs text-amber-300">Đang ghi bằng chứng lên blockchain, hệ thống tự thử lại.</p>}

      <div className="mt-3 flex flex-wrap items-start gap-2">
        {canChallenge && isOpen && v.recordTxHash && !open && (
          <Btn variant="danger" onClick={() => setOpen(true)}>Phản đối</Btn>
        )}
        <VerifyButton path={`/api/violations/${v.id}/verify`} label="Kiểm chứng bằng chứng" />
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-semibold text-slate-300">
            Lý do phản đối
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="VD: Đây là khung bảo trì đã thông báo trước cho khách hàng" className={`${inputCls} mt-1.5 h-auto py-2`} />
          </label>
          <ErrorNote message={error} />
          <div className="flex gap-2">
            <Btn variant="danger" onClick={challenge} loading={busy} disabled={!reason.trim()}>Gửi phản đối</Btn>
            <Btn variant="ghost" onClick={() => setOpen(false)}>Huỷ</Btn>
          </div>
        </div>
      )}
    </article>
  )
}

export default function ViolationList({ violations, canChallenge = true, onChanged }: { violations: Violation[]; canChallenge?: boolean; onChanged: () => void }) {
  if (violations.length === 0) return <Empty>Chưa có vụ vi phạm nào.</Empty>
  return (
    <div className="space-y-3">
      {violations.map((v) => <ViolationCard key={v.id} v={v} canChallenge={canChallenge} onChanged={onChanged} />)}
    </div>
  )
}

"use client"

import { useCallback, useEffect, useState } from "react"
import AdminFrame from "@/components/admin/admin-frame"
import { api } from "@/lib/api"
import { useSession } from "@/lib/session"
import type { Violation } from "@/lib/types"
import { Badge, Btn, Empty, ErrorNote, Loading, PARTY_LABEL, Panel, fmtDateTime, fmtPercent, inputCls } from "@/components/sla/ui"
import VerifyButton from "@/components/contracts/verify-button"
import SourceComparePanel, { VERDICT, type CompareRes } from "@/components/admin/source-compare-panel"

type SystemStatus = {
  connected: boolean
  message?: string
  contractAddress?: string
  operatorAddress?: string
  balancePol?: number | null
  lowBalance?: boolean
  estimatedTxRemaining?: number | null
  faucet?: string
  error?: string | null
  links?: { operator: string; contract: string | null }
}

// Đối chiếu nguồn dữ liệu của KPI bị vi phạm, từ trước lúc phát hiện tới nay (căn cứ để phân xử)
function SourceCheck({ v }: { v: Violation }) {
  const [res, setRes] = useState<CompareRes | null>(null)
  useEffect(() => {
    const minutes = Math.ceil((Date.now() - new Date(v.createdAt).getTime()) / 60_000) + 60
    api<CompareRes>(`/api/admin/source-compare?contractId=${v.contractId}&minutes=${minutes}`, { timeoutMs: 60_000 })
      .then(setRes)
      .catch(() => setRes(null))
  }, [v.contractId, v.createdAt])
  const kpi = res?.rows[0]?.kpis.find((k) => k.kpiCode === v.kpiCode)
  if (!kpi) return null
  return (
    <div className="mt-2 text-xs text-slate-300">
      Đối chiếu nguồn dữ liệu ({kpi.label}): <Badge tone={VERDICT[kpi.verdict].tone}>{VERDICT[kpi.verdict].label}</Badge>
      {kpi.notes.slice(0, 3).map((n) => <p key={n} className="mt-1 text-rose-200">• {n}</p>)}
    </div>
  )
}

// Admin tạm dừng / tiếp tục giám sát hợp đồng (hai bên không tự tạm dừng được). Xử lý xong vụ phản đối thì tự bật lại.
function MonitoringControl({ contractId }: { contractId: string }) {
  const [state, setState] = useState<{ pausedByAdmin: boolean; penaltyHold: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api<{ pausedByAdmin: boolean; penaltyHold: boolean }>(`/api/admin/contracts/${contractId}/monitoring`).then(setState).catch(() => setState(null))
  }, [contractId])
  const set = async (enabled: boolean) => {
    setBusy(true)
    setError(null)
    try {
      setState(await api(`/api/admin/contracts/${contractId}/monitoring`, { method: "POST", body: { enabled } }))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đổi được trạng thái giám sát")
    } finally {
      setBusy(false)
    }
  }
  if (!state) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-300">
      {state.penaltyHold && <Badge tone="amber">Đang tạm giữ mở vụ phạt mới</Badge>}
      {state.pausedByAdmin ? <Badge tone="amber">Giám sát đang tạm dừng</Badge> : <Badge tone="green">Đang giám sát</Badge>}
      <Btn variant="ghost" onClick={() => set(state.pausedByAdmin)} loading={busy}>{state.pausedByAdmin ? "Tiếp tục giám sát" : "Tạm dừng giám sát"}</Btn>
      <ErrorNote message={error} />
    </div>
  )
}

function ResolveCard({ v, onDone }: { v: Violation; onDone: () => void }) {
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const resolve = async (decision: "UPHOLD" | "DISMISS") => {
    setBusy(decision)
    setError(null)
    try {
      await api(`/api/violations/${v.id}/resolve`, { method: "POST", body: { decision, note } })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xử lý được")
    } finally {
      setBusy(null)
    }
  }

  return (
    <article className="rounded-xl border border-slate-700/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-sm font-bold text-blue-300">{v.contract.contractCode}</p>
        <Badge tone="violet">Phản đối bởi {v.challengedBy ? PARTY_LABEL[v.challengedBy].toLowerCase() : "—"}</Badge>
      </div>
      <p className="mt-2 text-sm text-slate-200">{v.kpiCode}: đo được {v.actualValue}, cam kết {v.targetValue}. Đề xuất hoàn {fmtPercent(v.creditBps)}.</p>
      <p className="mt-2 rounded-lg bg-violet-500/10 px-3 py-2 text-xs text-violet-200">Lý do: “{v.challengeReason}”</p>
      <p className="mt-1 text-xs text-slate-500">Phát hiện lúc {fmtDateTime(v.createdAt)}</p>
      <SourceCheck v={v} />
      <MonitoringControl contractId={v.contractId} />
      <div className="mt-3"><VerifyButton path={`/api/violations/${v.id}/verify`} label="Kiểm chứng bằng chứng" /></div>
      <label className="mt-3 block text-xs font-semibold text-slate-300">
        Lý do quyết định (bắt buộc)
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={`${inputCls} mt-1.5 h-auto py-2`} />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn variant="danger" onClick={() => resolve("UPHOLD")} loading={busy === "UPHOLD"} disabled={!note.trim()}>Giữ nguyên vi phạm</Btn>
        <Btn variant="ghost" onClick={() => resolve("DISMISS")} loading={busy === "DISMISS"} disabled={!note.trim()}>Chấp nhận phản đối, huỷ vi phạm</Btn>
      </div>
      <div className="mt-2"><ErrorNote message={error} /></div>
    </article>
  )
}

export default function AdminPage() {
  const { user } = useSession()
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [cases, setCases] = useState<Violation[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<SystemStatus>("/api/system/status").then(setStatus).catch((e) => setError(e.message))
    api<Violation[]>("/api/violations?status=CHALLENGED").then(setCases).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (user?.platformAdmin) load()
  }, [user, load])

  return (
    <AdminFrame>
        <ErrorNote message={error} />

        <Panel title="Blockchain và ví vận hành">
          {!status ? <Loading /> : !status.connected ? (
            <ErrorNote message={status.message || status.error || "Chưa kết nối blockchain"} />
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`text-3xl font-extrabold ${status.lowBalance ? "text-rose-300" : "text-emerald-300"}`}>{status.balancePol} POL</span>
                <span className="text-slate-400">≈ {status.estimatedTxRemaining} giao dịch nữa</span>
                {status.lowBalance && <Badge tone="red">Sắp hết POL</Badge>}
              </div>
              <p className="break-all text-xs text-slate-400">Ví vận hành: <a href={status.links?.operator} target="_blank" rel="noreferrer" className="font-mono text-blue-300">{status.operatorAddress}</a></p>
              <p className="break-all text-xs text-slate-400">Smart contract: {status.links?.contract ? <a href={status.links.contract} target="_blank" rel="noreferrer" className="font-mono text-blue-300">{status.contractAddress}</a> : "—"}</p>
              {status.lowBalance && status.faucet && <a href={status.faucet} target="_blank" rel="noreferrer" className="text-xs font-semibold text-amber-300">Nạp thêm POL testnet</a>}
            </div>
          )}
        </Panel>

        <SourceComparePanel />

        <Panel title="Vụ vi phạm bị phản đối" action={<Btn variant="ghost" onClick={load}>Tải lại</Btn>}>
          {!cases ? <Loading /> : cases.length === 0 ? <Empty>Không có vụ nào cần xử lý.</Empty> : (
            <div className="space-y-3">{cases.map((v) => <ResolveCard key={v.id} v={v} onDone={load} />)}</div>
          )}
        </Panel>
    </AdminFrame>
  )
}

"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import AppShell from "@/components/ui/app-shell"
import ViolationList from "@/components/contracts/violation-list"
import { API_BASE_URL, api } from "@/lib/api"
import { Check, Copy, ExternalLink } from "lucide-react"
import type { Contract, Violation } from "@/lib/types"
import { Badge, Btn, Empty, ErrorNote, Loading, Panel, StatusBadge, fmtDateTime } from "@/components/sla/ui"
import SlaGantt from "@/components/dashboard/sla-gantt"

type DemoState = { outage: boolean; extraDelayMs: number; probed?: number }
type Watcher = {
  contractId: string
  contractCode: string
  contractName: string | null
  status: string
  paused: boolean
  last: { isUp: boolean; detail: string; latencyMs: number | null; at: string } | null
}

const DEMO_URL = `${API_BASE_URL}/api/demo-provider/health`

function ago(at: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 1000))
  return s < 60 ? `${s} giây trước` : `${Math.round(s / 60)} phút trước`
}

// Nhà cung cấp mẫu: dùng khi demo để chủ động tạo sự cố, Oracle vẫn đo bằng HTTP thật
function DemoControls({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<DemoState | null>(null)
  const [watchers, setWatchers] = useState<Watcher[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(DEMO_URL)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError("Không sao chép được, hãy bôi đen URL và sao chép thủ công")
    }
  }

  const loadWatchers = useCallback(() => {
    api<Watcher[]>("/api/demo-provider/watchers").then(setWatchers).catch(() => setWatchers(null))
  }, [])

  useEffect(() => {
    api<DemoState>("/api/demo-provider/state").then(setState).catch(() => setState(null))
    loadWatchers()
    const t = setInterval(loadWatchers, 30_000)
    return () => clearInterval(t)
  }, [loadWatchers])

  const set = async (body: Partial<{ outage: boolean; delayMs: number }>, label: string) => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const r = await api<DemoState>("/api/demo-provider/state", { method: "POST", body, timeoutMs: 60_000 })
      setState(r)
      setNote(r.probed ? `${label}: đã đo lại ngay ${r.probed} hợp đồng đang theo dõi URL demo.` : `${label}. Chưa có hợp đồng nào đang theo dõi URL demo.`)
      loadWatchers()
      onChanged()
      window.dispatchEvent(new Event("sla:refresh"))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đổi được trạng thái")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Nhà cung cấp mẫu (demo)">
      <p className="text-xs leading-5 text-slate-400">Khi tạo hợp đồng, dán URL này vào ô &quot;URL dịch vụ cần giám sát&quot;, rồi bấm Gây sự cố để xem Oracle phát hiện vi phạm:</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="break-all rounded-lg border border-slate-700 bg-slate-800/40 px-3 py-2 font-mono text-xs text-slate-100">{DEMO_URL}</code>
        <Btn variant="ghost" onClick={copyUrl}>{copied ? <><Check className="h-4 w-4" />Đã sao chép</> : <><Copy className="h-4 w-4" />Sao chép</>}</Btn>
        <a href={DEMO_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-300 hover:underline">
          Mở thử <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      <p className="mt-3 text-sm text-slate-200">
        Trạng thái: {state ? (state.outage ? <strong className="text-rose-300">đang sập</strong> : <strong className="text-emerald-300">hoạt động</strong>) : "—"}
        {state && state.extraDelayMs > 0 && <span className="text-amber-300"> · chậm thêm {state.extraDelayMs}ms</span>}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn variant="danger" onClick={() => set({ outage: true }, "Đã gây sự cố")} loading={busy} disabled={state?.outage}>Gây sự cố</Btn>
        <Btn variant="ghost" onClick={() => set({ outage: false, delayMs: 0 }, "Đã khôi phục")} loading={busy}>Khôi phục</Btn>
        <Btn variant="ghost" onClick={() => set({ delayMs: 800 }, "Đã làm chậm 800ms")} loading={busy}>Làm chậm 800ms</Btn>
      </div>
      {note && <p className="mt-3 text-xs text-slate-300">{note}</p>}
      <div className="mt-3"><ErrorNote message={error} /></div>

      <div className="mt-4 border-t border-slate-800 pt-4">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Hợp đồng đang theo dõi URL demo</p>
        {watchers === null ? (
          <p className="mt-2 text-xs text-slate-500">—</p>
        ) : watchers.length === 0 ? (
          <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-200">
            Chưa có hợp đồng nào của bạn dùng URL demo, nên bấm Gây sự cố / Khôi phục sẽ không ảnh hưởng hợp đồng nào. Hãy tạo hợp đồng mới với URL giám sát ở trên.
          </p>
        ) : (
          <ul className="mt-2 max-h-[280px] divide-y divide-slate-800 overflow-y-auto pr-1">
            {watchers.map((w) => (
              <li key={w.contractId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <Link href={`/contracts/${w.contractId}`} className="text-sm font-semibold text-white hover:text-blue-300">{w.contractName || w.contractCode}</Link>
                  {w.contractName && <span className="ml-2 font-mono text-[11px] text-blue-300">{w.contractCode}</span>}
                  <p className="text-xs text-slate-400">
                    {w.paused ? "Admin đang tạm dừng giám sát" : w.last ? `Lần đo gần nhất ${ago(w.last.at)}: ${w.last.detail}${w.last.latencyMs !== null ? ` · ${w.last.latencyMs}ms` : ""}` : "Chưa đo lần nào"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {w.last && !w.paused && <Badge tone={w.last.isUp ? "green" : "red"}>{w.last.isUp ? "UP" : "DOWN"}</Badge>}
                  <StatusBadge status={w.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] leading-5 text-slate-500">
          Bấm Khôi phục, hệ thống đo lại ngay và đóng đoạn sự cố. Hợp đồng vẫn ở trạng thái <em>Đang vi phạm</em> cho tới khi uptime trong kỳ đo quay lại trên mức cam kết, vì thời gian đã sập vẫn được tính.
        </p>
      </div>
    </Panel>
  )
}

export default function DashboardPage() {
  const [contracts, setContracts] = useState<Contract[] | null>(null)
  const [violations, setViolations] = useState<Violation[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [c, v] = await Promise.all([api<Contract[]>("/api/contracts/list"), api<Violation[]>("/api/violations")])
      setContracts(c)
      setViolations(v)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được dữ liệu")
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  const open = violations.filter((v) => v.status === "PENDING" || v.status === "CHALLENGED")
  const count = (s: string) => (contracts ?? []).filter((c) => c.status === s).length
  const stats = [
    { label: "Đang hiệu lực", value: count("ACTIVE"), cls: "text-emerald-300" },
    { label: "Chờ ký", value: count("PENDING_SIGNATURE"), cls: "text-violet-300" },
    { label: "Đang vi phạm", value: count("VIOLATED"), cls: "text-rose-300" },
    { label: "Vi phạm chờ xử lý", value: open.length, cls: "text-amber-300" },
  ]

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white">Dashboard</h1>
            <p className="mt-2 text-sm text-slate-400">Số liệu cập nhật mỗi 30 giây theo chu kỳ đo của Oracle.</p>
          </div>
          <Link href="/create-sla" className="inline-flex h-10 items-center rounded-lg bg-blue-600 px-4 text-sm font-bold text-white">Tạo hợp đồng</Link>
        </div>

        <ErrorNote message={error} />
        {!contracts && !error && <Loading />}

        {contracts && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="rounded-2xl border border-slate-700/70 bg-[#0b1424]/85 p-5">
                  <p className="text-xs text-slate-400">{s.label}</p>
                  <p className={`mt-1 text-3xl font-extrabold ${s.cls}`}>{s.value}</p>
                </div>
              ))}
            </div>

            <SlaGantt />

            <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
              <Panel title="Vi phạm đang mở">
                <div className="max-h-[480px] overflow-y-auto pr-1"><ViolationList violations={open} onChanged={load} /></div>
              </Panel>
              <Panel title="Hợp đồng gần đây" action={<Link href="/contracts/sent" className="text-xs font-semibold text-blue-300">Xem tất cả</Link>}>
                {contracts.length === 0 ? (
                  <Empty>Chưa có hợp đồng.</Empty>
                ) : (
                  <ul className="max-h-[480px] divide-y divide-slate-800 overflow-y-auto pr-1">
                    {contracts.slice(0, 8).map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <Link href={`/contracts/${c.id}`} className="block truncate text-sm font-semibold text-white hover:text-blue-300">{c.contractName || c.contractCode}</Link>
                          {c.contractName && <span className="font-mono text-[11px] text-blue-300">{c.contractCode}</span>}
                          <p className="truncate text-xs text-slate-400">{c.serviceName} · {fmtDateTime(c.createdAt)}</p>
                        </div>
                        <StatusBadge status={c.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            <Panel title="Lịch sử vi phạm">
              <div className="max-h-[520px] overflow-y-auto pr-1"><ViolationList violations={violations.filter((v) => !open.includes(v)).slice(0, 10)} onChanged={load} canChallenge={false} /></div>
            </Panel>

            <DemoControls onChanged={load} />
          </>
        )}
      </main>
    </AppShell>
  )
}

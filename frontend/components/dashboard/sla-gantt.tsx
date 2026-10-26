"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { api } from "@/lib/api"
import { ErrorNote, Panel, StatusBadge, fmtDateTime, fmtPercent } from "@/components/sla/ui"

type Incident = { from: string; to: string | null; source: "HTTP" | "WEBHOOK" }
type TlViolation = { id: string; kpiCode: string; detectedAt: string; challengeDeadline: string; closedAt: string | null; status: string; creditBps: number }
type Row = {
  id: string
  contractCode: string
  contractName: string | null
  serviceName: string
  status: string
  clientName: string
  providerName: string
  createdAt: string
  effectiveFrom: string | null
  effectiveEnd: string | null
  signatures: { party: string; signedAt: string }[]
  monitoring: boolean
  incidents: Incident[]
  violations: TlViolation[]
}
type Timeline = { range: string; from: string; to: string; now: string; rows: Row[] }

const RANGES = [
  { key: "1h", label: "1 giờ" },
  { key: "24h", label: "24 giờ" },
  { key: "all", label: "Toàn hợp đồng" },
] as const
type RangeKey = (typeof RANGES)[number]["key"]

const KPI_NAME: Record<string, string> = { UPTIME: "Uptime", RESPONSE_TIME: "Thời gian phản hồi", FIRST_RESPONSE: "Phản hồi ticket", RESOLUTION_TIME: "Xử lý ticket", INCIDENT_RESPONSE: "Ứng phó sự cố" }
const PARTY = { BUYER: "Bên mua", SUPPLIER: "Nhà cung cấp" } as Record<string, string>

const fmtDur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} giây`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} phút ${s % 60 ? `${s % 60} giây` : ""}`.trim()
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} giờ ${m % 60} phút`
  return `${Math.floor(h / 24)} ngày`
}

// Nhãn trục thời gian theo độ dài cửa sổ
function ticks(from: number, to: number) {
  const span = to - from
  const steps = [5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000, 3_600_000, 3 * 3_600_000, 6 * 3_600_000, 86_400_000, 7 * 86_400_000, 30 * 86_400_000, 90 * 86_400_000]
  const step = steps.find((s) => span / s <= 8) ?? 180 * 86_400_000
  const out: number[] = []
  // Canh theo giờ Việt Nam
  const off = 7 * 3_600_000
  let t = Math.ceil((from + off) / step) * step - off
  for (; t <= to; t += step) out.push(t)
  const label = (x: number) => {
    const d = new Date(x)
    return step < 86_400_000
      ? d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" })
      : d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" })
  }
  return out.map((x) => ({ x, label: label(x) }))
}

// Biểu đồ Gantt: mỗi hợp đồng 1 dòng (thời hạn, mốc ký, sự cố, vụ vi phạm + thời hạn phản đối). Dữ liệu tải lại mỗi 30 giây, vạch "bây giờ" chạy từng giây.
export default function SlaGantt() {
  const [range, setRange] = useState<RangeKey>("1h")
  const [data, setData] = useState<Timeline | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [loadedAt, setLoadedAt] = useState(() => Date.now())

  const load = useCallback(async () => {
    try {
      const d = await api<Timeline>(`/api/dashboard/timeline?range=${range}`, { timeoutMs: 60_000 })
      setData(d)
      setLoadedAt(Date.now())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được biểu đồ")
    }
  }, [range])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    const t = setInterval(load, 30_000)
    // Nút demo vừa đổi trạng thái -> tải lại ngay
    window.addEventListener("sla:refresh", load)
    return () => {
      clearInterval(t)
      window.removeEventListener("sla:refresh", load)
    }
  }, [load])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Cửa sổ trượt theo thời gian thực (1 giờ / 24 giờ); "Toàn hợp đồng" giữ khung cố định
  const win = useMemo(() => {
    if (!data) return null
    if (data.range === "all") return { from: new Date(data.from).getTime(), to: Math.max(new Date(data.to).getTime(), now) }
    const span = new Date(data.to).getTime() - new Date(data.from).getTime()
    // Chừa 8% bên phải để thấy rõ vạch "bây giờ" và thời hạn phản đối sắp tới
    return { from: now - span, to: now + span * 0.08 }
  }, [data, now])

  const pos = useCallback(
    (t: number) => {
      if (!win) return 0
      return Math.min(100, Math.max(0, ((t - win.from) / (win.to - win.from)) * 100))
    },
    [win],
  )
  const bar = (a: number, b: number, min = 0.4) => {
    const l = pos(a)
    const r = pos(b)
    return { left: `${l}%`, width: `${Math.max(min, r - l)}%` }
  }

  const ongoing = data?.rows.flatMap((r) => r.incidents.filter((i) => !i.to).map((i) => ({ row: r, i }))) ?? []

  return (
    <Panel
      title="Tiến trình hợp đồng (Gantt)"
      action={
        <div className="flex gap-1" role="tablist" aria-label="Khoảng thời gian">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              role="tab"
              aria-selected={range === r.key}
              onClick={() => setRange(r.key)}
              className={`h-8 rounded-lg px-3 text-xs font-semibold ${range === r.key ? "bg-blue-600 text-white" : "text-slate-300"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm bg-emerald-500/35" />Thời hạn hiệu lực</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rotate-45 bg-violet-500" />Ký</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm bg-rose-600" />Sự cố (downtime)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm bg-amber-400" />Thời hạn phản đối</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm bg-slate-500" />Đã chốt</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-blue-600" />Bây giờ</span>
        <span className="ml-auto font-mono text-[11px]">Cập nhật {Math.round((now - loadedAt) / 1000)} giây trước</span>
      </div>

      {ongoing.length > 0 && (
        <div className="mb-3 rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-100" role="status">
          {ongoing.map(({ row, i }) => (
            <p key={row.id + i.from}>
              <strong className="font-mono">{row.contractCode}</strong> đang gặp sự cố, đã kéo dài <strong className="font-mono">{fmtDur(now - new Date(i.from).getTime())}</strong>
            </p>
          ))}
        </div>
      )}

      <ErrorNote message={error} />
      {!data && !error && <p className="py-6 text-sm text-slate-400">Đang tải biểu đồ…</p>}
      {data && data.rows.length === 0 && <p className="py-6 text-sm text-slate-400">Chưa có hợp đồng để hiển thị.</p>}

      {data && win && data.rows.length > 0 && (
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            {/* Trục thời gian */}
            <div className="grid grid-cols-[220px_1fr] gap-3">
              <div />
              <div className="relative h-6 border-b border-slate-700/80">
                {ticks(win.from, win.to).map((t) => (
                  <span key={t.x} className="absolute -translate-x-1/2 font-mono text-[10px] text-slate-500" style={{ left: `${pos(t.x)}%` }}>{t.label}</span>
                ))}
              </div>
            </div>

            <div className="max-h-[420px] overflow-y-auto">
            {data.rows.map((r) => {
              const start = new Date(r.effectiveFrom ?? r.createdAt).getTime()
              const end = r.effectiveEnd ? new Date(r.effectiveEnd).getTime() : win.to
              return (
                <div key={r.id} className="grid grid-cols-[220px_1fr] items-center gap-3 border-b border-slate-800 py-2.5 last:border-0">
                  <div className="min-w-0">
                    <Link href={`/contracts/${r.id}`} className="block truncate text-sm font-semibold text-white hover:text-blue-300" title={r.contractName ?? r.serviceName}>
                      {r.contractName ?? r.serviceName}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="font-mono text-[11px] text-slate-400">{r.contractCode}</span>
                      <StatusBadge status={r.status} />
                    </div>
                  </div>
                  <div className="relative h-9 rounded-md bg-slate-800/40">
                    {/* lưới dọc */}
                    {ticks(win.from, win.to).map((t) => (
                      <span key={t.x} className="absolute inset-y-0 w-px bg-slate-700/40" style={{ left: `${pos(t.x)}%` }} />
                    ))}
                    {/* thời hạn hiệu lực */}
                    {end > win.from && start < win.to && (
                      <span
                        className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-sm ${r.status === "PENDING_SIGNATURE" ? "bg-violet-500/20" : r.status === "TERMINATED" ? "bg-slate-500/30" : "bg-emerald-500/30"}`}
                        style={bar(start, end)}
                        title={`Hiệu lực ${fmtDateTime(new Date(start).toISOString())}${r.effectiveEnd ? ` → ${fmtDateTime(r.effectiveEnd)}` : ""}`}
                      />
                    )}
                    {/* sự cố */}
                    {r.incidents.map((i) => {
                      const a = new Date(i.from).getTime()
                      const b = i.to ? new Date(i.to).getTime() : now
                      return (
                        <span
                          key={i.source + i.from}
                          className={`absolute top-1/2 h-5 -translate-y-1/2 rounded-sm bg-rose-600 ${i.to ? "" : "animate-pulse"}`}
                          style={bar(a, b, 0.6)}
                          title={`Sự cố (${i.source === "HTTP" ? "HTTP check" : "webhook"}) ${fmtDateTime(i.from)} → ${i.to ? fmtDateTime(i.to) : "đang diễn ra"} · ${fmtDur(b - a)}`}
                        />
                      )
                    })}
                    {/* vụ vi phạm: khung phản đối (cam) rồi chốt (xám) */}
                    {r.violations.map((v) => {
                      const a = new Date(v.detectedAt).getTime()
                      const dl = new Date(v.challengeDeadline).getTime()
                      const closed = v.closedAt ? new Date(v.closedAt).getTime() : null
                      const pending = v.status === "PENDING" || v.status === "CHALLENGED"
                      return (
                        <span key={v.id}>
                          <span
                            className={`absolute bottom-0.5 h-1.5 rounded-sm ${pending ? "bg-amber-400" : "bg-slate-500"}`}
                            style={bar(a, pending ? Math.max(dl, now) : (closed ?? dl), 0.6)}
                            title={`${KPI_NAME[v.kpiCode] ?? v.kpiCode}: hoàn ${fmtPercent(v.creditBps)} · ${pending ? `hạn phản đối ${fmtDateTime(v.challengeDeadline)}${dl > now ? ` (còn ${fmtDur(dl - now)})` : ""}` : `đã ${v.status === "DISMISSED" ? "huỷ" : "chốt"}`}`}
                          />
                          <span className="absolute bottom-0 top-0 w-0.5 bg-amber-500" style={{ left: `${pos(a)}%` }} title={`Phát hiện vi phạm ${fmtDateTime(v.detectedAt)}`} />
                        </span>
                      )
                    })}
                    {/* mốc ký */}
                    {r.signatures.map((s) => {
                      const t = new Date(s.signedAt).getTime()
                      if (t < win.from || t > win.to) return null
                      return (
                        <span key={s.party} className="absolute top-1 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-violet-500" style={{ left: `${pos(t)}%` }} title={`${PARTY[s.party] ?? s.party} ký lúc ${fmtDateTime(s.signedAt)}`} />
                      )
                    })}
                    {/* bây giờ */}
                    <span className="absolute -inset-y-1 w-0.5 bg-blue-600" style={{ left: `${pos(now)}%` }} />
                  </div>
                </div>
              )
            })}
            </div>
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">Rê chuột lên từng đoạn để xem chi tiết. Dữ liệu tải lại mỗi 30 giây theo chu kỳ đo của Oracle; đoạn sự cố đang diễn ra tự kéo dài từng giây.</p>
    </Panel>
  )
}

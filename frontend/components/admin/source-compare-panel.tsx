"use client"

import Link from "next/link"
import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Database, Plus, Webhook, X } from "lucide-react"
import { api } from "@/lib/api"
import { Badge, Btn, ErrorNote, Loading, Panel, fmtDateTime } from "@/components/sla/ui"

export type SourceKey = "BASE" | "WEBHOOK_CLIENT" | "WEBHOOK_PROVIDER"
type Incident = { from: string; to: string | null }
type TicketBar = { id: string; from: string; to: string | null; met: boolean | null }
type SourceResult = {
  configured: boolean
  since: string | null
  value: number | null
  samples: number
  ready: boolean
  incidents?: Incident[]
  points?: { t: string; v: number }[]
  tickets?: TicketBar[]
}
export type KpiCompare = {
  kpiCode: string
  label: string
  unit: string
  target: number
  baseLabel: string
  kpiSource: SourceKey | null
  sources: Record<SourceKey, SourceResult>
  maxDiff: number | null
  verdict: "MATCH" | "MISMATCH" | "NO_DATA" | "SINGLE"
  notes: string[]
}
type CompareRow = { id: string; contractCode: string; contractName: string | null; status: string; clientName: string; providerName: string; kpis: KpiCompare[] }
export type CompareRes = { from: string; to: string; now: string; minutes: number; rows: CompareRow[] }

const HOOKS = ["WEBHOOK_CLIENT", "WEBHOOK_PROVIDER"] as const
const HOOK_NAME: Record<(typeof HOOKS)[number], string> = { WEBHOOK_CLIENT: "Webhook client", WEBHOOK_PROVIDER: "Webhook provider" }
const nameOf = (k: KpiCompare, s: SourceKey) => (s === "BASE" ? k.baseLabel : HOOK_NAME[s])
// Màu từng nguồn (dùng cho dải nền và đường biểu đồ)
const LANE_BG: Record<SourceKey, string> = { BASE: "bg-blue-500/25", WEBHOOK_CLIENT: "bg-emerald-500/25", WEBHOOK_PROVIDER: "bg-violet-500/25" }
const LINE: Record<SourceKey, string> = { BASE: "#09090b", WEBHOOK_CLIENT: "#52525b", WEBHOOK_PROVIDER: "#a1a1aa" }

const KPI_TABS = [
  { code: "UPTIME", label: "Uptime" },
  { code: "RESPONSE_TIME", label: "Thời gian phản hồi" },
  { code: "FIRST_RESPONSE", label: "Phản hồi ticket" },
  { code: "RESOLUTION_TIME", label: "Xử lý ticket" },
]

export const VERDICT: Record<KpiCompare["verdict"], { label: string; tone: "green" | "red" | "slate" | "amber" }> = {
  MATCH: { label: "Khớp", tone: "green" },
  MISMATCH: { label: "Lệch", tone: "red" },
  NO_DATA: { label: "Chưa đủ dữ liệu", tone: "amber" },
  SINGLE: { label: "Chỉ 1 nguồn", tone: "slate" },
}

const RANGES = [
  { label: "Kỳ đo", minutes: 0 },
  { label: "24 giờ", minutes: 24 * 60 },
  { label: "7 ngày", minutes: 7 * 24 * 60 },
]

const fmtVal = (v: number | null, unit: string) =>
  v === null ? "—" : unit === "ms" ? `${Math.round(v).toLocaleString("vi-VN")} ms` : `${v.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%`
const sampleUnit = (k: KpiCompare, s: SourceKey) =>
  k.kpiCode === "UPTIME" ? (s === "BASE" ? "lần đo" : "sự kiện") : k.kpiCode === "RESPONSE_TIME" ? "mẫu" : "ticket"
const diffText = (k: KpiCompare) => (k.maxDiff === null ? "" : k.unit === "ms" ? ` · ${Math.round(k.maxDiff)}ms` : ` · ${k.maxDiff}đ`)

function SourceCell({ k, s }: { k: KpiCompare; s: SourceKey }) {
  const r = k.sources[s]
  if (!r.configured) return <span className="text-xs text-slate-500">Chưa kết nối</span>
  return (
    <span className="font-mono text-sm text-white">
      {fmtVal(r.value, k.unit)}
      <span className="ml-1 text-[11px] text-slate-400">· {r.samples} {sampleUnit(k, s)}</span>
    </span>
  )
}

// Trục thời gian dùng chung
function useAxis(from: number, to: number) {
  return useMemo(() => {
    const pos = (t: number) => Math.min(100, Math.max(0, ((t - from) / (to - from)) * 100))
    const ticks = Array.from({ length: 7 }, (_, i) => from + ((to - from) * i) / 6)
    const label = (t: number) =>
      to - from <= 2 * 86_400_000
        ? new Date(t).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" })
        : new Date(t).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" })
    return { pos, ticks, label }
  }, [from, to])
}

function AxisRow({ from, to }: { from: number; to: number }) {
  const { pos, ticks, label } = useAxis(from, to)
  return (
    <div className="grid grid-cols-[150px_1fr] gap-3">
      <div />
      <div className="relative h-5 border-b border-slate-700/80">
        {ticks.map((t, i) => (
          <span key={t} className={`absolute font-mono text-[10px] text-slate-500 ${i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: `${pos(t)}%` }}>
            {label(t)}
          </span>
        ))}
      </div>
    </div>
  )
}

// Uptime / ticket: mỗi nguồn 1 làn
function Lane({ k, s, from, to }: { k: KpiCompare; s: SourceKey; from: number; to: number }) {
  const { pos, ticks } = useAxis(from, to)
  const r = k.sources[s]
  const bar = (a: number, b: number, min = 0.5) => ({ left: `${pos(a)}%`, width: `${Math.max(min, pos(b) - pos(a))}%` })
  const since = r.since ? new Date(r.since).getTime() : from
  const tickets = r.tickets ?? []
  const rowsOf = Math.min(4, Math.max(1, tickets.length))
  return (
    <div className="grid grid-cols-[150px_1fr] items-center gap-3 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-white">{nameOf(k, s)}</p>
        <p className="font-mono text-[11px] text-slate-400">{r.configured ? fmtVal(r.value, k.unit) : "chưa kết nối"}</p>
      </div>
      <div className={`relative rounded-md bg-slate-800/40 ${k.kpiCode === "UPTIME" ? "h-7" : "h-9"}`}>
        {ticks.map((t) => <span key={t} className="absolute inset-y-0 w-px bg-slate-700/40" style={{ left: `${pos(t)}%` }} />)}
        {k.kpiCode === "UPTIME" && r.configured && <span className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-sm ${LANE_BG[s]}`} style={bar(since, to)} />}
        {(r.incidents ?? []).map((i) => {
          const a = new Date(i.from).getTime()
          const b = i.to ? new Date(i.to).getTime() : to
          return (
            <span
              key={i.from}
              className={`absolute top-1/2 h-5 -translate-y-1/2 rounded-sm bg-rose-600 ${i.to ? "" : "animate-pulse"}`}
              style={bar(a, b, 0.6)}
              title={`DOWN ${fmtDateTime(i.from)} → ${i.to ? fmtDateTime(i.to) : "đang diễn ra"}`}
            />
          )
        })}
        {tickets.map((t, idx) => {
          const a = new Date(t.from).getTime()
          const b = t.to ? new Date(t.to).getTime() : to
          const color = t.met === true ? "bg-emerald-500" : t.met === false ? "bg-rose-600" : "bg-amber-400"
          return (
            <span
              key={t.id + t.from}
              className={`absolute h-1.5 rounded-sm ${color}`}
              style={{ ...bar(a, b, 0.8), top: `${4 + (idx % rowsOf) * (28 / rowsOf)}px` }}
              title={`${t.id}: mở ${fmtDateTime(t.from)} → ${t.to ? fmtDateTime(t.to) : "chưa xong"} · ${t.met === true ? "đạt" : t.met === false ? "không đạt" : "đang chờ"}`}
            />
          )
        })}
      </div>
    </div>
  )
}

// Thời gian phản hồi: 1 biểu đồ, mỗi nguồn 1 đường
function LatencyChart({ k, shown, from, to }: { k: KpiCompare; shown: SourceKey[]; from: number; to: number }) {
  const W = 1000
  const H = 160
  const series = shown.map((s) => ({ s, pts: k.sources[s].points ?? [] })).filter((x) => x.pts.length)
  const maxV = Math.max(k.target * 1.2, ...series.flatMap((x) => x.pts.map((p) => p.v)), 1)
  const x = (t: number) => ((t - from) / (to - from)) * W
  const y = (v: number) => H - (v / maxV) * (H - 8)
  return (
    <div className="grid grid-cols-[150px_1fr] gap-3 py-1.5">
      <div className="space-y-1.5 text-xs">
        {shown.map((s) => (
          <p key={s} className="flex items-center gap-1.5 text-white">
            <span className="h-0.5 w-4" style={{ background: LINE[s] }} />
            {nameOf(k, s)} <span className="font-mono text-[11px] text-slate-400">{fmtVal(k.sources[s].value, "ms")}</span>
          </p>
        ))}
        <p className="flex items-center gap-1.5 text-slate-400"><span className="h-0 w-4 border-t border-dashed border-slate-400" />Cam kết ≤ {k.target} ms</p>
      </div>
      <div className="relative rounded-md bg-slate-800/40">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label={`Thời gian phản hồi theo nguồn`}>
          <line x1={0} x2={W} y1={y(k.target)} y2={y(k.target)} stroke="#71717a" strokeDasharray="6 5" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {series.map(({ s, pts }) => (
            <polyline
              key={s}
              fill="none"
              stroke={LINE[s]}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              points={pts.map((p) => `${x(new Date(p.t).getTime()).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")}
            />
          ))}
        </svg>
        <span className="absolute left-1 top-1 font-mono text-[10px] text-slate-500">{Math.round(maxV)} ms</span>
        {!series.length && <p className="absolute inset-0 grid place-items-center text-xs text-slate-500">Chưa có số đo trong khoảng này</p>}
      </div>
    </div>
  )
}

// Phần mở rộng của 1 hợp đồng: nguồn gốc SMART-SLA luôn hiện, webhook client / provider bật thêm bằng nút
function Detail({ k, from, to }: { k: KpiCompare; from: number; to: number }) {
  const [shown, setShown] = useState<SourceKey[]>([])
  const toggle = (s: SourceKey) => setShown((v) => (v.includes(s) ? v.filter((x) => x !== s) : [...v, s]))
  const active: SourceKey[] = ["BASE", ...HOOKS.filter((h) => shown.includes(h))]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-500/60 bg-blue-500/10 px-3 text-xs font-semibold text-white">
          <Database className="h-3.5 w-3.5" />{k.baseLabel}
        </span>
        {HOOKS.map((h) => {
          const on = shown.includes(h)
          const ok = k.sources[h].configured
          return (
            <button
              key={h}
              type="button"
              disabled={!ok}
              onClick={() => toggle(h)}
              aria-pressed={on}
              title={ok ? undefined : `Hợp đồng chưa kết nối ${HOOK_NAME[h].toLowerCase()}`}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${on ? "border-slate-400 bg-slate-500/10 text-white" : "border-dashed border-slate-600 text-slate-300"}`}
            >
              {on ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              <Webhook className="h-3.5 w-3.5" />
              {HOOK_NAME[h]}
            </button>
          )
        })}
        {k.kpiCode !== "UPTIME" && k.kpiCode !== "RESPONSE_TIME" && (
          <span className="ml-auto flex items-center gap-3 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1"><span className="h-1.5 w-4 rounded-sm bg-emerald-500" />Đạt</span>
            <span className="inline-flex items-center gap-1"><span className="h-1.5 w-4 rounded-sm bg-rose-600" />Không đạt</span>
            <span className="inline-flex items-center gap-1"><span className="h-1.5 w-4 rounded-sm bg-amber-400" />Đang chờ</span>
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <AxisRow from={from} to={to} />
          {k.kpiCode === "RESPONSE_TIME" ? (
            <LatencyChart k={k} shown={active} from={from} to={to} />
          ) : (
            active.map((s) => <Lane key={s} k={k} s={s} from={from} to={to} />)
          )}
        </div>
      </div>

      {k.notes.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {k.notes.map((n) => <li key={n}>• {n}</li>)}
        </ul>
      ) : k.verdict === "MATCH" ? (
        <p className="text-xs text-emerald-300">Các nguồn khớp nhau trong khoảng thời gian này.</p>
      ) : null}
    </div>
  )
}

// Panel Admin: đối chiếu từng KPI giữa nguồn SMART-SLA tự đo và webhook của từng bên
export default function SourceComparePanel() {
  const [minutes, setMinutes] = useState(0)
  const [kpiCode, setKpiCode] = useState("UPTIME")
  const [data, setData] = useState<CompareRes | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      setData(await api<CompareRes>(`/api/admin/source-compare${minutes ? `?minutes=${minutes}` : ""}`, { timeoutMs: 60_000 }))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được dữ liệu đối chiếu")
    } finally {
      setBusy(false)
    }
  }, [minutes])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const from = data ? new Date(data.from).getTime() : 0
  const to = data ? new Date(data.to).getTime() : 0
  const count = (code: string) => data?.rows.filter((r) => r.kpis.some((k) => k.kpiCode === code)).length ?? 0
  const flagged = (code: string) => data?.rows.filter((r) => r.kpis.some((k) => k.kpiCode === code && k.verdict === "MISMATCH")).length ?? 0
  const order = { MISMATCH: 0, MATCH: 1, NO_DATA: 2, SINGLE: 3 }
  const rows = (data?.rows ?? [])
    .map((r) => ({ r, k: r.kpis.find((x) => x.kpiCode === kpiCode) }))
    .filter((x): x is { r: CompareRow; k: KpiCompare } => !!x.k)
    .sort((a, b) => order[a.k.verdict] - order[b.k.verdict])
  const baseLabel = rows[0]?.k.baseLabel ?? (kpiCode === "UPTIME" || kpiCode === "RESPONSE_TIME" ? "HTTP (SMART-SLA)" : "Chat SMART-SLA")

  return (
    <Panel
      title="Đối chiếu nguồn dữ liệu KPI"
      action={
        <div className="flex flex-wrap items-center gap-1">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              aria-pressed={minutes === r.minutes}
              onClick={() => setMinutes(r.minutes)}
              className={`h-8 rounded-lg px-3 text-xs font-semibold ${minutes === r.minutes ? "bg-blue-600 text-white" : "text-slate-300"}`}
            >
              {r.label}
            </button>
          ))}
          <Btn variant="ghost" onClick={load} loading={busy}>Tải lại</Btn>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-700/80" role="tablist" aria-label="KPI">
        {KPI_TABS.map((t) => (
          <button
            key={t.code}
            type="button"
            role="tab"
            aria-selected={kpiCode === t.code}
            onClick={() => {
              setKpiCode(t.code)
              setOpen(null)
            }}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold ${kpiCode === t.code ? "border-blue-600 text-white" : "border-transparent text-slate-400"}`}
          >
            {t.label}
            <span className="font-mono text-[11px] text-slate-500">{count(t.code)}</span>
            {flagged(t.code) > 0 && <Badge tone="red">{flagged(t.code)} lệch</Badge>}
          </button>
        ))}
      </div>

      <p className="mb-3 text-xs leading-5 text-slate-400">
        KPI tính theo thứ tự ưu tiên <strong className="text-slate-200">webhook client → webhook provider → {baseLabel}</strong>. {baseLabel} do SMART-SLA tự ghi nhận, luôn chạy song song để đối chiếu.
        {data && <> Khoảng xét: {fmtDateTime(data.from)} → {fmtDateTime(data.to)}.</>}
      </p>
      <ErrorNote message={error} />
      {!data && !error && <Loading />}
      {data && rows.length === 0 && <p className="py-4 text-sm text-slate-400">Chưa có hợp đồng nào đo KPI này.</p>}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-slate-400">
              <tr className="border-b border-slate-700/80">
                <th className="py-2 pr-3 font-semibold">Hợp đồng</th>
                <th className="py-2 pr-3 font-semibold">{baseLabel}</th>
                <th className="py-2 pr-3 font-semibold">Webhook client</th>
                <th className="py-2 pr-3 font-semibold">Webhook provider</th>
                <th className="py-2 pr-3 font-semibold">Nguồn tính KPI</th>
                <th className="py-2 pr-3 font-semibold">Đối chiếu</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, k }) => {
                const isOpen = open === r.id
                return (
                  <Fragment key={r.id}>
                    <tr className="cursor-pointer border-b border-slate-800 hover:bg-slate-800/30" onClick={() => setOpen(isOpen ? null : r.id)}>
                      <td className="py-2.5 pr-3">
                        <Link href={`/contracts/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-sm font-bold text-blue-300 hover:text-blue-200">{r.contractCode}</Link>
                        <p className="max-w-[200px] truncate text-xs text-slate-400" title={r.contractName ?? ""}>{r.contractName ?? `${r.clientName} ↔ ${r.providerName}`}</p>
                      </td>
                      <td className="py-2.5 pr-3"><SourceCell k={k} s="BASE" /></td>
                      <td className="py-2.5 pr-3"><SourceCell k={k} s="WEBHOOK_CLIENT" /></td>
                      <td className="py-2.5 pr-3"><SourceCell k={k} s="WEBHOOK_PROVIDER" /></td>
                      <td className="py-2.5 pr-3 text-xs text-slate-200">{k.kpiSource ? nameOf(k, k.kpiSource) : "—"}</td>
                      <td className="py-2.5 pr-3">
                        <Badge tone={VERDICT[k.verdict].tone}>{VERDICT[k.verdict].label}{k.verdict !== "SINGLE" ? diffText(k) : ""}</Badge>
                      </td>
                      <td className="py-2.5 text-slate-400">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-slate-800">
                        <td colSpan={7} className="py-3">
                          <Detail key={r.id + k.kpiCode} k={k} from={from} to={to} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

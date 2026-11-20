"use client"

import { useMemo } from "react"
import { Plus, Trash2 } from "lucide-react"
import type { Catalog, Kpi } from "@/lib/types"
import { Btn, Field, Panel, inputCls } from "@/components/sla/ui"
import SeverityBadge from "@/components/contracts/severity-badge"
import { severityOf } from "@/lib/terms"
import KpiGuide from "@/components/contracts/kpi-guide"

// Khối nhập KPI dùng chung cho trang Tạo SLA và Sửa điều khoản
const DAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"]

type TierRow = { maxBreach: string; creditPercent: string }
export type KpiRow = {
  kpiCode: string
  target: string
  dataSource: string
  windowDays: string
  maintenance: boolean
  day: number
  start: string
  end: string
  tiers: TierRow[]
  minPercent: string // KPI ticket: % ticket phải đạt ngưỡng
}

export const toRow = (k: Pick<Kpi, "kpiCode" | "target" | "dataSource" | "windowMinutes" | "exclusions" | "creditTiers" | "minPercent">): KpiRow => ({
  minPercent: k.minPercent === null || k.minPercent === undefined ? "" : String(k.minPercent),
  kpiCode: k.kpiCode,
  target: String(k.target),
  dataSource: k.dataSource,
  windowDays: String(Math.max(1, Math.round(k.windowMinutes / 1440))),
  maintenance: (k.exclusions ?? []).length > 0,
  day: k.exclusions?.[0]?.dayOfWeek ?? 0,
  start: k.exclusions?.[0]?.start ?? "02:00",
  end: k.exclusions?.[0]?.end ?? "04:00",
  tiers: (k.creditTiers ?? []).map((t) => ({ maxBreach: t.maxBreach === null ? "" : String(t.maxBreach), creditPercent: String(t.creditBps / 100) })),
})


// Chuyển các dòng trên form thành dữ liệu KPI gửi lên backend
export function rowsToKpis(rows: KpiRow[], catalog: Catalog) {
  const kpiMeta = Object.fromEntries(catalog.kpis.map((k) => [k.code, k]))
  return rows.map((r) => ({
          kpiCode: r.kpiCode,
          target: Number(r.target),
          dataSource: r.dataSource,
          windowMinutes: Math.round(Number(r.windowDays) * 1440),
          exclusions: r.maintenance ? [{ dayOfWeek: r.day, start: r.start, end: r.end, note: "Bảo trì định kỳ" }] : [],
          creditTiers: r.tiers.map((t) => ({ maxBreach: t.maxBreach.trim() === "" ? null : Number(t.maxBreach), creditBps: Math.round(Number(t.creditPercent) * 100) })),
          ...(kpiMeta[r.kpiCode]?.defaultMinPercent !== undefined ? { minPercent: Number(r.minPercent) } : {}),
        }))
}

export default function KpiEditor({ catalog, rows, setRows }: { catalog: Catalog; rows: KpiRow[]; setRows: React.Dispatch<React.SetStateAction<KpiRow[]>> }) {
  const kpiMeta = useMemo(() => Object.fromEntries(catalog.kpis.map((k) => [k.code, k])), [catalog])

  const update = (i: number, patch: Partial<KpiRow>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  const addKpi = () => {
    const used = new Set(rows.map((r) => r.kpiCode))
    const next = catalog.kpis.find((k) => !used.has(k.code))
    if (!next) return
    setRows((rs) => [
      ...rs,
      toRow({ kpiCode: next.code, target: next.defaultTarget, dataSource: next.sources[0], windowMinutes: 30 * 1440, exclusions: [], creditTiers: next.defaultTiers, minPercent: next.defaultMinPercent }),
    ])
  }

  const changeKpiCode = (i: number, code: string) => {
    const meta = kpiMeta[code]
    if (!meta) return
    update(i, toRow({ kpiCode: code, target: meta.defaultTarget, dataSource: meta.sources[0], windowMinutes: Number(rows[i].windowDays) * 1440, exclusions: [], creditTiers: meta.defaultTiers, minPercent: meta.defaultMinPercent }))
  }

  return (
            <Panel title="KPI và mức hoàn phí" action={<Btn variant="ghost" onClick={addKpi} disabled={rows.length >= catalog.kpis.length}><Plus className="h-4 w-4" />Thêm KPI</Btn>}>
              <div className="space-y-5">
                {rows.map((r, i) => {
                  const meta = kpiMeta[r.kpiCode]
                  const isTicket = meta?.defaultMinPercent !== undefined
                  const breachWord = meta?.comparator === "GTE" || isTicket ? "Hụt dưới (điểm %)" : "Vượt dưới (%)"
                  return (
                    <div key={i} className="rounded-xl border border-slate-700/80 p-4">
                      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1.3fr_.8fr_auto] sm:items-end">
                        <Field label="KPI">
                          <select value={r.kpiCode} onChange={(e) => changeKpiCode(i, e.target.value)} className={inputCls}>
                            {catalog.kpis.map((k) => (
                              <option key={k.code} value={k.code} disabled={k.code !== r.kpiCode && rows.some((x) => x.kpiCode === k.code)}>{k.name}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label={`Cam kết (${meta?.comparator === "GTE" ? "≥" : "≤"} ${meta?.unit ?? ""}${meta?.maxTarget !== undefined ? `, tối đa ${meta.maxTarget}` : ""})`}>
                          <input
                            type="number"
                            step="any"
                            max={meta?.maxTarget}
                            value={r.target}
                            onChange={(e) => {
                              const v = e.target.value
                              const max = meta?.maxTarget
                              update(i, { target: max !== undefined && Number(v) > max ? String(max) : v })
                            }}
                            className={inputCls}
                          />
                        </Field>
                        <Field label="Nguồn dữ liệu">
                          <select value={r.dataSource} onChange={(e) => update(i, { dataSource: e.target.value })} className={inputCls}>
                            {(meta?.sources ?? []).map((s) => (
                              <option key={s} value={s}>{catalog.dataSources.find((d) => d.code === s)?.label ?? s}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Kỳ đo (ngày)">
                          <input type="number" min={1} value={r.windowDays} onChange={(e) => update(i, { windowDays: e.target.value })} className={inputCls} />
                        </Field>
                        <button type="button" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))} className="mb-1 grid h-10 w-10 place-items-center rounded-lg border border-slate-700 text-slate-400 hover:text-rose-300" aria-label={`Xoá KPI ${meta?.name ?? ""}`}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      {meta && <p className="mt-2 text-xs text-slate-500">{meta.description}</p>}
                      <KpiGuide kpiCode={r.kpiCode} target={r.target} minPercent={r.minPercent} dataSource={r.dataSource} windowDays={r.windowDays} tiers={r.tiers} maintenance={r.maintenance} />
                      {isTicket && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                          <span>Cam kết tối thiểu</span>
                          <input type="number" min={1} max={100} step="any" value={r.minPercent} onChange={(e) => update(i, { minPercent: e.target.value })} className={`${inputCls} h-8 w-24`} aria-label="Tỷ lệ ticket tối thiểu phải đạt" />
                          <span>% ticket đạt ngưỡng trên. Ticket lấy từ chat SMART-SLA và webhook (Jira, Zendesk…).</span>
                        </div>
                      )}

                      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-300">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={r.maintenance} onChange={(e) => update(i, { maintenance: e.target.checked })} className="h-4 w-4" />
                          Không tính khung bảo trì hằng tuần
                        </label>
                        {r.maintenance && (
                          <>
                            <select value={r.day} onChange={(e) => update(i, { day: Number(e.target.value) })} className={`${inputCls} h-8 w-32`} aria-label="Ngày bảo trì">
                              {DAYS.map((d, idx) => <option key={d} value={idx}>{d}</option>)}
                            </select>
                            <input type="time" value={r.start} onChange={(e) => update(i, { start: e.target.value })} className={`${inputCls} h-8 w-28`} aria-label="Bắt đầu" />
                            <span>đến</span>
                            <input type="time" value={r.end} onChange={(e) => update(i, { end: e.target.value })} className={`${inputCls} h-8 w-28`} aria-label="Kết thúc" />
                            <span className="text-slate-500">(giờ Việt Nam)</span>
                          </>
                        )}
                      </div>

                      <div className="mt-4">
                        <p className="mb-2 text-xs font-semibold text-slate-300">Bậc phạt Minor / Moderate / Severe, xếp từ nhẹ đến nặng (bậc cuối để trống = áp dụng cho mọi mức nặng hơn)</p>
                        <div className="space-y-2">
                          {r.tiers.map((t, ti) => (
                            <div key={ti} className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                              <span className="w-20"><SeverityBadge severity={severityOf(ti, r.tiers.length)} /></span>
                              <span className="w-28">{breachWord}</span>
                              <input
                                value={t.maxBreach}
                                placeholder="không giới hạn"
                                onChange={(e) => update(i, { tiers: r.tiers.map((x, xi) => (xi === ti ? { ...x, maxBreach: e.target.value } : x)) })}
                                className={`${inputCls} h-8 w-32`}
                                aria-label="Mức vi phạm tối đa của bậc"
                              />
                              <span>→ hoàn</span>
                              <input
                                type="number"
                                step="any"
                                value={t.creditPercent}
                                onChange={(e) => update(i, { tiers: r.tiers.map((x, xi) => (xi === ti ? { ...x, creditPercent: e.target.value } : x)) })}
                                className={`${inputCls} h-8 w-24`}
                                aria-label="Phần trăm hoàn phí"
                              />
                              <span>% phí</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                })}
                {rows.length === 0 && <p className="text-sm text-slate-400">Chưa có KPI nào. Bấm “Thêm KPI”.</p>}
              </div>
            </Panel>
  )
}

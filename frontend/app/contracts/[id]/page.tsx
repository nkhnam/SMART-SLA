"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, FileBarChart } from "lucide-react"
import AppShell from "@/components/ui/app-shell"
import SigningPanel from "@/components/contracts/signing-panel"
import MonitoringPanel from "@/components/contracts/monitoring-panel"
import ViolationList from "@/components/contracts/violation-list"
import VerifyButton from "@/components/contracts/verify-button"
import EditTermsPanel from "@/components/contracts/edit-terms-panel"
import { ConditionsView } from "@/components/contracts/conditions-editor"
import UptimeHistoryPanel from "@/components/contracts/uptime-history-panel"
import { myPartyOf } from "@/components/contracts/contracts-workspace"
import SeverityBadge from "@/components/contracts/severity-badge"
import ContractName from "@/components/contracts/contract-name"
import PenaltyCapBar from "@/components/contracts/penalty-cap-bar"
import { TERM_STATE, fmtVnd, fmtYmd, severityOf, sortTiers, termStateOf, vnDate } from "@/lib/terms"
import { api, polygonscanTx } from "@/lib/api"
import { useSession } from "@/lib/session"
import type { Contract, KpiSummary, Violation } from "@/lib/types"
import { Badge, ErrorNote, Loading, PARTY_LABEL, Panel, StatusBadge, fmtDateTime, fmtPercent, shortHash } from "@/components/sla/ui"

const DAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"]
const SOURCE = { HTTP_CHECK: "SMART-SLA tự đo (HTTP)", WEBHOOK: "Webhook 2 bên + SMART-SLA đối chiếu", TICKET: "Chat hỗ trợ SMART-SLA" } as Record<string, string>

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useSession()
  const [contract, setContract] = useState<Contract | null>(null)
  const [kpi, setKpi] = useState<KpiSummary | null>(null)
  const [violations, setViolations] = useState<Violation[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const c = await api<Contract>(`/api/contracts/${id}`)
      setContract(c)
      const [k, v] = await Promise.all([
        api<KpiSummary>(`/api/contracts/${id}/kpi`).catch(() => null),
        api<Violation[]>("/api/violations").catch(() => [] as Violation[]),
      ])
      setKpi(k)
      setViolations(v.filter((x) => x.contractId === id))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không tải được hợp đồng")
    }
  }, [id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    const t = setInterval(load, 30_000) // KPI và vi phạm cập nhật theo chu kỳ đo của Oracle
    return () => clearInterval(t)
  }, [load])

  const party = contract ? myPartyOf(contract, user?.organization.id) : null

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-10 sm:px-6">
        <Link href="/contracts/sent" className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white"><ArrowLeft className="h-4 w-4" />Danh sách hợp đồng</Link>
        <ErrorNote message={error} />
        {!contract && !error && <Loading />}

        {contract && (
          <>
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="font-mono text-3xl font-extrabold text-white">{contract.contractCode}</h1>
                  <StatusBadge status={contract.status} />
                  {party && <Badge tone="blue">Bạn là {PARTY_LABEL[party].toLowerCase()}</Badge>}
                </div>
                <ContractName id={contract.id} name={contract.contractName} fallback="Chưa đặt tên hợp đồng" canEdit={!!party} onSaved={load} />
                <p className="mt-1 text-sm text-slate-300">Dịch vụ: {contract.serviceName}</p>
                <p className="mt-1 text-sm text-slate-400">Bên mua: <span className="text-slate-200">{contract.client.name}</span> · Nhà cung cấp: <span className="text-slate-200">{contract.provider.name}</span></p>
                <p className="mt-1 text-xs text-slate-500">Tạo lúc {fmtDateTime(contract.createdAt)} · Thời hạn phản đối {Math.round(contract.challengeWindowSeconds / 3600)} giờ</p>
                <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <div><dt className="text-xs text-slate-500">Giá trị hợp đồng</dt><dd className="font-semibold text-white">{contract.contractValueVnd ? `${fmtVnd(contract.contractValueVnd)}/tháng` : "Chưa khai báo"}</dd></div>
                  <div><dt className="text-xs text-slate-500">Thời hạn</dt><dd className="font-semibold text-white">{contract.effectiveFrom ? `${fmtYmd(vnDate(contract.effectiveFrom))} → ${fmtYmd(vnDate(contract.effectiveTo))}` : "Chưa khai báo"}</dd></div>
                  {(() => {
                    const st = TERM_STATE[termStateOf(contract.effectiveFrom, contract.effectiveTo)]
                    return <div><dt className="text-xs text-slate-500">Hiệu lực</dt><dd className={`font-semibold ${st.cls}`}>{st.label}</dd></div>
                  })()}
                </dl>
              </div>
              <div className="text-right text-xs text-slate-400">
                {contract.txHash ? (
                  <a href={polygonscanTx(contract.txHash)!} target="_blank" rel="noreferrer" className="font-semibold text-blue-300 hover:text-blue-200">Giao dịch ghi hợp đồng trên Polygonscan</a>
                ) : (
                  <span>{contract.status === "PENDING_SIGNATURE" ? "Ghi lên blockchain sau khi hai bên ký" : "Chưa ghi lên blockchain"}</span>
                )}
                <p className="mt-1 font-mono">slaHash {shortHash(contract.slaHash)}</p>
                {contract.contractAddress && (
                  <p className="mt-1 font-mono">
                    Smart contract{" "}
                    <a href={`https://amoy.polygonscan.com/address/${contract.contractAddress}`} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200">{shortHash(contract.contractAddress)}</a>
                  </p>
                )}
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <VerifyButton path={`/api/contracts/${contract.id}/verify`} label="Kiểm chứng hợp đồng" />
                  {contract.status !== "PENDING_SIGNATURE" && (
                    <Link href={`/contracts/${contract.id}/report`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-blue-500/50 bg-blue-500/10 px-3 text-xs font-semibold text-blue-200 hover:bg-blue-500/20">
                      <FileBarChart className="h-4 w-4" />Báo cáo đối soát
                    </Link>
                  )}
                </div>
              </div>
            </header>

            {/* key theo phiên bản điều khoản: sửa điều khoản xong thì khung ký tải lại nội dung mới */}
            {contract.penaltyCap && <PenaltyCapBar cap={contract.penaltyCap} />}

            {contract.terminationAlert && (
              <div className="rounded-2xl border border-rose-500/50 bg-rose-500/10 px-5 py-4 text-sm text-rose-100" role="alert">
                <p className="font-bold text-white">Đủ điều kiện chấm dứt hợp đồng</p>
                <p className="mt-1">
                  Uptime dưới {contract.terminationAlert.threshold}% trong {contract.terminationAlert.periods.length} kỳ liên tiếp:{" "}
                  {contract.terminationAlert.periods.map((p) => `${p.label} đạt ${p.uptime}%`).join(", ")}.
                  Theo điều khoản chấm dứt (nếu có trong hợp đồng), Bên mua có quyền đơn phương chấm dứt ngay và được hoàn phần phí chưa sử dụng.
                </p>
                <p className="mt-1 text-xs text-rose-200/80">Phát hiện tự động lúc {fmtDateTime(contract.terminationAlert.at)} từ dữ liệu SMART-SLA đo được.</p>
              </div>
            )}

            {party && <SigningPanel key={contract.termsVersion ?? 1} contractId={contract.id} onSigned={load} />}
            {party && contract.status === "PENDING_SIGNATURE" && <EditTermsPanel contract={contract} onSaved={load} />}

            <Panel title="Điều khoản KPI">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="text-xs text-slate-400">
                    <tr><th className="pb-2 font-semibold">KPI</th><th className="pb-2 font-semibold">Cam kết</th><th className="pb-2 font-semibold">Nguồn</th><th className="pb-2 font-semibold">Kỳ đo</th><th className="pb-2 font-semibold">Loại trừ</th><th className="pb-2 font-semibold">Mức phạt (hoàn phí)</th></tr>
                  </thead>
                  <tbody className="align-top">
                    {contract.kpis.map((k) => (
                      <tr key={k.kpiCode} className="border-t border-slate-800">
                        <td className="py-3 font-semibold text-white">{k.name}</td>
                        <td className="py-3 text-slate-200">
                          {k.comparator === "GTE" ? "≥" : "≤"} {k.target}{k.unit}
                          {k.minPercent !== null && k.minPercent !== undefined && <span className="block text-xs text-slate-400">cho ≥ {k.minPercent}% ticket</span>}
                        </td>
                        <td className="py-3 text-slate-300">{SOURCE[k.dataSource] ?? k.dataSource}</td>
                        <td className="py-3 text-slate-300">{Math.round(k.windowMinutes / 1440)} ngày</td>
                        <td className="py-3 text-xs text-slate-400">{k.exclusions.length ? k.exclusions.map((e) => `${DAYS[e.dayOfWeek]} ${e.start}–${e.end}`).join(", ") : "—"}</td>
                        <td className="py-3 text-xs text-slate-400">
                          {sortTiers(k.creditTiers).map((t, i, arr) => (
                            <div key={i} className="mb-1 flex flex-wrap items-center gap-1.5"><SeverityBadge severity={severityOf(i, arr.length)} />{t.maxBreach === null ? "Nặng hơn" : k.minPercent !== null && k.minPercent !== undefined ? `Hụt dưới ${t.maxBreach} điểm %` : `${k.comparator === "GTE" ? "Hụt" : "Vượt"} dưới ${t.maxBreach}%`}: hoàn {fmtPercent(t.creditBps)}{contract.contractValueVnd ? ` (${fmtVnd((contract.contractValueVnd * t.creditBps) / 10000)})` : ""}</div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel title="Điều kiện bổ sung">
              <p className="mb-3 text-xs text-slate-400">Do hai bên tự thống nhất, hệ thống không tự đo. Nội dung được băm và ký cùng hợp đồng.</p>
              <ConditionsView conditions={contract.additionalConditions} />
            </Panel>

            {kpi && (
              <Panel title="KPI đo thật">
                {!kpi.monitoring ? (
                  <p className="text-sm text-slate-400">Chưa có nguồn dữ liệu đang hoạt động.</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {kpi.kpis.map((r) => (
                      <div key={r.kpiCode} className={`rounded-xl border p-4 ${r.breached ? "border-rose-500/50 bg-rose-500/10" : "border-slate-700/80"}`}>
                        <p className="text-xs text-slate-400">{r.name}</p>
                        <p className="mt-1 text-2xl font-extrabold text-white">{r.actual === null ? "—" : `${r.actual}${r.unit}`}</p>
                        <p className="mt-1 text-xs text-slate-400">Cam kết {r.comparator === "GTE" ? "≥" : "≤"} {r.target}{r.unit} · {r.samples} mẫu{r.downtimeSeconds !== undefined ? ` · sập ${r.downtimeSeconds}s` : ""}</p>
                        {!r.ready && <p className="mt-1 text-xs text-amber-300">{r.note ?? "Chưa đủ dữ liệu để kết luận"}</p>}
                        {r.ready && r.note && <p className="mt-1 text-xs text-slate-500">{r.note}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            )}

            {party && contract.status !== "PENDING_SIGNATURE" && <UptimeHistoryPanel contractId={contract.id} />}

            {party && <MonitoringPanel contract={contract} party={party} onChanged={load} />}

            <Panel title="Vụ vi phạm">
              <ViolationList violations={violations} canChallenge={!!party} onChanged={load} />
            </Panel>
          </>
        )}
      </main>
    </AppShell>
  )
}

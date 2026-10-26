"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, Printer, RefreshCw } from "lucide-react"
import AppShell from "@/components/ui/app-shell"
import SeverityBadge from "@/components/contracts/severity-badge"
import PenaltyCapBar, { type PenaltyCapInfo } from "@/components/contracts/penalty-cap-bar"
import VerifyButton from "@/components/contracts/verify-button"
import { api, polygonscanTx } from "@/lib/api"
import { TERM_STATE, fmtVnd, fmtYmd, type Severity } from "@/lib/terms"
import { Btn, ErrorNote, Loading, PARTY_LABEL, fmtDateTime, fmtPercent, shortHash } from "@/components/sla/ui"

type PartyBlock = {
  name: string
  serviceType?: string
  reputation?: number
  representative: { fullName: string; jobTitle: string | null } | null
  signature: { method: string | null; signedAt: string; wallet: string | null; email: string | null } | null
}
type Measurement = {
  kpiCode: string
  name: string
  unit: string
  comparator: string
  target: number
  actual: number | null
  samples: number
  note?: string
  downtimeSeconds?: number
  verdict: "MET" | "BREACHED" | "NO_DATA"
}
type ReportViolation = {
  id: string
  kpiCode: string
  kpiName: string
  unit: string
  targetValue: number
  actualValue: number
  severity: Severity | null
  creditBps: number
  creditVnd: number | null
  cappedByLimit?: boolean
  status: string
  outcome: "APPLIED" | "PROVISIONAL" | "DISMISSED"
  detectedAt: string
  challengeDeadline: string
  challengedBy: string | null
  challengeReason: string | null
  resolutionNote: string | null
  evidenceHash: string
  recordTxHash: string | null
  settleTxHash: string | null
}
type Period = { index: number; from: string; to: string; current: boolean }
type Report = {
  generatedAt: string
  contract: {
    id: string
    contractCode: string
    contractName?: string | null
    serviceName: string
    status: string
    contractValueVnd: number | null
    effectiveFrom: string | null
    effectiveTo: string | null
    termState: string
    challengeWindowHours: number
    hashVersion: number
    slaHash: string | null
    txHash: string | null
  }
  chain: { network: string; contractAddress: string | null; contractLink: string | null; txLink: string | null }
  parties: { buyer: PartyBlock; supplier: PartyBlock }
  cycle: { minutes: number; demo: boolean }
  penaltyCap: PenaltyCapInfo | null
  terms: {
    kpiCode: string
    name: string
    unit: string
    comparator: string
    target: number
    minPercent: number | null
    tiers: { maxBreach: number | null; creditBps: number; severity: Severity; creditVnd: number | null }[]
  }[]
  periods: Period[]
  period: Period | null
  measurements: Measurement[]
  violations: ReportViolation[]
  totals: {
    contractValueVnd: number | null
    violations: number
    appliedBps: number
    appliedVnd: number | null
    provisionalBps: number
    provisionalVnd: number | null
    payableVnd: number | null
    payableIfUpheldVnd: number | null
  }
}

const VERDICT = {
  MET: { label: "Đạt", cls: "text-emerald-300" },
  BREACHED: { label: "Vi phạm", cls: "text-rose-300" },
  NO_DATA: { label: "Chưa đủ dữ liệu", cls: "text-slate-400" },
} as const

const OUTCOME = {
  APPLIED: { label: "Đã chốt, khấu trừ", cls: "text-rose-200" },
  PROVISIONAL: { label: "Tạm tính", cls: "text-amber-200" },
  DISMISSED: { label: "Đã huỷ", cls: "text-slate-400 line-through" },
} as const

const STATUS_VI: Record<string, string> = {
  PENDING: "Trong hạn phản đối",
  CHALLENGED: "Đang bị phản đối",
  SETTLED: "Đã chốt",
  UPHELD: "Giữ nguyên sau xử lý",
  DISMISSED: "Đã huỷ sau xử lý",
}

const cycleText = (minutes: number, demo: boolean) =>
  demo ? `${minutes} phút (chế độ demo)` : minutes % 1440 === 0 ? `${minutes / 1440} ngày` : `${Math.round(minutes / 60)} giờ`

const methodText = (m: string | null) => (m === "EIP712" ? "Chữ ký số ví (EIP-712)" : m === "OTP_EMAIL" ? "Mã OTP qua email" : m ?? "—")

export default function ReconciliationReportPage() {
  const { id } = useParams<{ id: string }>()
  const [report, setReport] = useState<Report | null>(null)
  const [period, setPeriod] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const q = period !== "" ? `?period=${encodeURIComponent(period)}` : ""
      setReport(await api<Report>(`/api/contracts/${id}/report${q}`))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được báo cáo")
    } finally {
      setBusy(false)
    }
  }, [id, period])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  // Kỳ đang diễn ra: số liệu thay đổi theo thời gian -> tự làm mới mỗi 30 giây
  const live = !!report?.period?.current
  useEffect(() => {
    if (!live) return
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [live, load])

  const r = report
  const st = r ? TERM_STATE[r.contract.termState] ?? TERM_STATE.UNSET : null

  return (
    <AppShell>
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm; }
          .report, .report * { color: #000 !important; background: transparent !important; box-shadow: none !important; border-color: #bbb !important; }
          .report a { text-decoration: underline; }
          .report section { break-inside: avoid; }
        }
      `}</style>
      <main className="report mx-auto w-full max-w-6xl space-y-6 px-4 py-10 sm:px-6 print:max-w-none print:p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link href={`/contracts/${id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-300 hover:text-white">
            <ArrowLeft className="h-4 w-4" />Về trang hợp đồng
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {r && r.periods.length > 0 && (
              <select
                value={period === "" ? String(r.period?.index ?? "") : period}
                onChange={(e) => setPeriod(e.target.value)}
                className="h-10 rounded-lg border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-100"
                aria-label="Chọn kỳ đối soát"
              >
                {r.periods.map((p) => (
                  <option key={p.index} value={p.index}>
                    Kỳ {p.index + 1}: {fmtDateTime(p.from)} → {fmtDateTime(p.to)}{p.current ? " (đang diễn ra)" : ""}
                  </option>
                ))}
              </select>
            )}
            <Btn variant="ghost" onClick={load} loading={busy}><RefreshCw className="h-4 w-4" />Làm mới</Btn>
            <Btn onClick={() => window.print()} disabled={!r}><Printer className="h-4 w-4" />In / Lưu PDF</Btn>
          </div>
        </div>

        <ErrorNote message={error} />
        {!r && !error && <Loading text="Đang lập báo cáo đối soát…" />}

        {r && (
          <>
            <header className="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-6">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-300">SLA-DEX · Báo cáo đối soát</p>
              <h1 className="mt-2 text-3xl font-extrabold text-white">
                {r.contract.contractName || r.contract.serviceName}
              </h1>
              <p className="mt-1 text-sm text-slate-300"><span className="font-mono font-medium">{r.contract.contractCode}</span> · {r.contract.serviceName}</p>
              {r.period ? (
                <p className="mt-2 text-sm text-slate-300">
                  Kỳ {r.period.index + 1}: <strong className="text-white">{fmtDateTime(r.period.from)}</strong> → <strong className="text-white">{fmtDateTime(r.period.to)}</strong>
                  {r.period.current ? (
                    <span className="ml-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-xs font-semibold text-amber-200">Kỳ đang diễn ra, số liệu tạm tính</span>
                  ) : (
                    <span className="ml-2 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-xs font-semibold text-emerald-200">Kỳ đã kết thúc</span>
                  )}
                </p>
              ) : (
                <p className="mt-2 text-sm text-amber-300">Hợp đồng chưa tới ngày hiệu lực nên chưa có kỳ đối soát nào.</p>
              )}
              <p className="mt-1 text-xs text-slate-500">Lập tự động lúc {fmtDateTime(r.generatedAt)} từ dữ liệu SLA-DEX đo được và bằng chứng ghi trên {r.chain.network}.</p>
            </header>

            {r.penaltyCap && <PenaltyCapBar cap={r.penaltyCap} />}

            {/* Tổng hợp tiền */}
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="Giá trị hợp đồng / kỳ" value={fmtVnd(r.totals.contractValueVnd)} />
              <Tile label="Hoàn phí đã chốt" value={fmtVnd(r.totals.appliedVnd)} sub={fmtPercent(r.totals.appliedBps)} tone="rose" />
              <Tile label="Hoàn phí đang chờ (tạm tính)" value={fmtVnd(r.totals.provisionalVnd)} sub={`${fmtPercent(r.totals.provisionalBps)} · trong hạn phản đối`} tone="amber" />
              <Tile
                label={r.period?.current ? "Bên mua thanh toán (dự kiến)" : "Bên mua thanh toán"}
                value={fmtVnd(r.totals.provisionalBps ? r.totals.payableIfUpheldVnd : r.totals.payableVnd)}
                sub={r.totals.provisionalBps ? `Nếu phần tạm tính bị huỷ: ${fmtVnd(r.totals.payableVnd)}` : "Sau khi trừ hoàn phí"}
                tone="emerald"
              />
            </section>
            {!r.totals.contractValueVnd && (
              <p className="text-sm text-amber-300">Hợp đồng này tạo trước khi có trường giá trị hợp đồng nên báo cáo chỉ hiện % hoàn phí, chưa quy ra tiền.</p>
            )}

            {/* Thông tin hợp đồng + các bên */}
            <section className="grid gap-4 lg:grid-cols-3">
              <Box title="Hợp đồng">
                <Row k="Giá trị" v={r.contract.contractValueVnd ? `${fmtVnd(r.contract.contractValueVnd)}/tháng` : "—"} />
                <Row k="Hiệu lực" v={`${fmtYmd(r.contract.effectiveFrom)} → ${fmtYmd(r.contract.effectiveTo)}`} />
                <Row k="Tình trạng" v={<span className={st?.cls}>{st?.label}</span>} />
                <Row k="Chu kỳ đối soát" v={cycleText(r.cycle.minutes, r.cycle.demo)} />
                <Row k="Thời hạn phản đối" v={`${r.contract.challengeWindowHours} giờ`} />
              </Box>
              {(["buyer", "supplier"] as const).map((key) => {
                const p = r.parties[key]
                return (
                  <Box key={key} title={PARTY_LABEL[key === "buyer" ? "BUYER" : "SUPPLIER"]}>
                    <Row k="Doanh nghiệp" v={p.name} />
                    {key === "supplier" && <Row k="Lĩnh vực" v={p.serviceType ?? "—"} />}
                    {key === "supplier" && <Row k="Điểm uy tín" v={String(p.reputation ?? "—")} />}
                    <Row k="Người đại diện" v={p.representative ? `${p.representative.fullName}${p.representative.jobTitle ? ` · ${p.representative.jobTitle}` : ""}` : "—"} />
                    <Row k="Ký lúc" v={p.signature ? fmtDateTime(p.signature.signedAt) : "Chưa ký"} />
                    {p.signature && <Row k="Hình thức" v={methodText(p.signature.method)} />}
                    {p.signature?.wallet && <Row k="Ví ký" v={<span className="font-mono">{shortHash(p.signature.wallet)}</span>} />}
                  </Box>
                )
              })}
            </section>

            {/* KPI cam kết vs đo được */}
            <section className="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-5">
              <h2 className="text-base font-bold text-white">1. Chỉ số cam kết và kết quả đo trong kỳ</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs text-slate-400">
                    <tr><th className="pb-2">Chỉ số</th><th className="pb-2">Cam kết</th><th className="pb-2">Đo được</th><th className="pb-2">Số mẫu</th><th className="pb-2">Kết luận</th></tr>
                  </thead>
                  <tbody>
                    {r.measurements.map((m) => (
                      <tr key={m.kpiCode} className="border-t border-slate-800 align-top">
                        <td className="py-2.5 font-semibold text-white">{m.name}</td>
                        <td className="py-2.5 text-slate-200">{m.comparator === "GTE" ? "≥" : "≤"} {m.target}{m.unit}</td>
                        <td className="py-2.5 text-slate-200">
                          {m.actual === null ? "—" : `${m.actual}${m.unit}`}
                          {m.downtimeSeconds !== undefined && <span className="block text-xs text-slate-500">sập {m.downtimeSeconds}s</span>}
                        </td>
                        <td className="py-2.5 text-slate-400">{m.samples}</td>
                        <td className={`py-2.5 font-semibold ${VERDICT[m.verdict].cls}`}>
                          {VERDICT[m.verdict].label}
                          {m.verdict === "NO_DATA" && m.note && <span className="block text-xs font-normal text-slate-500">{m.note}</span>}
                        </td>
                      </tr>
                    ))}
                    {!r.measurements.length && <tr><td colSpan={5} className="py-3 text-slate-400">Chưa có kỳ đối soát.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Vụ vi phạm + tiền phạt */}
            <section className="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-5">
              <h2 className="text-base font-bold text-white">2. Vi phạm và khấu trừ tự động ({r.violations.length})</h2>
              {r.violations.length === 0 ? (
                <p className="mt-3 text-sm text-emerald-300">Không có vi phạm trong kỳ. Bên mua thanh toán đủ giá trị hợp đồng.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[860px] text-left text-sm">
                    <thead className="text-xs text-slate-400">
                      <tr><th className="pb-2">Phát hiện lúc</th><th className="pb-2">Chỉ số</th><th className="pb-2">Cam kết / Đo</th><th className="pb-2">Mức phạt</th><th className="pb-2">Hoàn phí</th><th className="pb-2">Trạng thái</th><th className="pb-2">Bằng chứng</th></tr>
                    </thead>
                    <tbody>
                      {r.violations.map((v) => (
                        <tr key={v.id} className="border-t border-slate-800 align-top">
                          <td className="py-2.5 text-slate-300">{fmtDateTime(v.detectedAt)}</td>
                          <td className="py-2.5 font-semibold text-white">{v.kpiName}</td>
                          <td className="py-2.5 text-slate-200">{v.targetValue}{v.unit} / <span className="text-rose-300">{v.actualValue}{v.unit}</span></td>
                          <td className="py-2.5"><SeverityBadge severity={v.severity} /></td>
                          <td className={`py-2.5 ${OUTCOME[v.outcome].cls}`}>
                            {fmtPercent(v.creditBps)}
                            <span className="block font-semibold">{fmtVnd(v.creditVnd)}</span>
                            {v.cappedByLimit && <span className="block text-[11px] text-amber-300">Đã giới hạn theo trần phạt</span>}
                          </td>
                          <td className="py-2.5 text-xs">
                            <span className={`font-semibold ${OUTCOME[v.outcome].cls}`}>{OUTCOME[v.outcome].label}</span>
                            <span className="block text-slate-400">{STATUS_VI[v.status] ?? v.status}</span>
                            {v.status === "PENDING" && <span className="block text-slate-500">Hạn phản đối {fmtDateTime(v.challengeDeadline)}</span>}
                            {v.challengeReason && <span className="block text-slate-500">Lý do phản đối: {v.challengeReason}</span>}
                          </td>
                          <td className="py-2.5 text-xs">
                            <span className="block font-mono text-slate-400">{shortHash(v.evidenceHash)}</span>
                            {v.recordTxHash && <a href={polygonscanTx(v.recordTxHash)!} target="_blank" rel="noreferrer" className="block text-blue-300">Ghi nhận on-chain</a>}
                            {v.settleTxHash && <a href={polygonscanTx(v.settleTxHash)!} target="_blank" rel="noreferrer" className="block text-blue-300">Chốt on-chain</a>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Bậc phạt theo hợp đồng */}
            <section className="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-5">
              <h2 className="text-base font-bold text-white">3. Quy tắc phạt đã ký</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {r.terms.map((k) => (
                  <div key={k.kpiCode} className="rounded-xl border border-slate-700/80 p-4">
                    <p className="text-sm font-semibold text-white">
                      {k.name} {k.comparator === "GTE" ? "≥" : "≤"} {k.target}{k.unit}
                      {k.minPercent !== null && <span className="text-xs font-normal text-slate-400"> cho ≥ {k.minPercent}% ticket</span>}
                    </p>
                    <ul className="mt-2 space-y-1.5 text-xs text-slate-300">
                      {k.tiers.map((t, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2">
                          <SeverityBadge severity={t.severity} />
                          <span>
                            {t.maxBreach === null ? "Nặng hơn" : `${k.minPercent !== null ? "Hụt dưới" : k.comparator === "GTE" ? "Hụt dưới" : "Vượt dưới"} ${t.maxBreach}${k.minPercent !== null || k.comparator === "GTE" ? " điểm %" : "%"}`}
                            {" → "}hoàn {fmtPercent(t.creditBps)}{t.creditVnd !== null ? ` (${fmtVnd(t.creditVnd)})` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            {/* Minh bạch */}
            <section className="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-5">
              <h2 className="text-base font-bold text-white">4. Dấu vân tay và kiểm chứng</h2>
              <dl className="mt-3 grid gap-2 text-sm">
                <Row k="Dấu vân tay SLA (slaHash)" v={<span className="break-all font-mono text-xs">{r.contract.slaHash ?? "Chưa ghi lên blockchain"}</span>} />
                <Row k="Giao dịch ghi hợp đồng" v={r.chain.txLink ? <a href={r.chain.txLink} target="_blank" rel="noreferrer" className="break-all font-mono text-xs text-blue-300">{r.contract.txHash}</a> : "—"} />
                <Row k={`Smart contract (${r.chain.network})`} v={r.chain.contractLink ? <a href={r.chain.contractLink} target="_blank" rel="noreferrer" className="break-all font-mono text-xs text-blue-300">{r.chain.contractAddress}</a> : "—"} />
              </dl>
              <p className="mt-3 text-xs text-slate-400">
                Bất kỳ ai cũng có thể tính lại dấu vân tay từ nội dung hợp đồng và đối chiếu với dữ liệu trên blockchain. Mỗi vụ vi phạm có mã bằng chứng riêng, ghi on-chain kèm thời hạn phản đối.
              </p>
              <div className="mt-3 print:hidden"><VerifyButton path={`/api/contracts/${r.contract.id}/verify`} label="Kiểm chứng hợp đồng ngay" /></div>
            </section>

            <footer className="pb-4 text-center text-xs text-slate-500">
              Báo cáo do SLA-DEX lập tự động · {r.contract.contractCode} · {fmtDateTime(r.generatedAt)}
            </footer>
          </>
        )}
      </main>
    </AppShell>
  )
}

function Tile({ label, value, sub, tone = "slate" }: { label: string; value: string; sub?: string; tone?: "slate" | "rose" | "amber" | "emerald" }) {
  const ring = { slate: "border-slate-700/80", rose: "border-rose-500/40", amber: "border-amber-400/40", emerald: "border-emerald-400/40" }[tone]
  return (
    <div className={`rounded-2xl border ${ring} bg-slate-900/60 p-4`}>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-extrabold text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-300">{title}</h2>
      <dl className="space-y-2 text-sm">{children}</dl>
    </div>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
      <dt className="text-slate-400">{k}</dt>
      <dd className="text-right text-slate-100">{v}</dd>
    </div>
  )
}

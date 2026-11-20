"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Globe, Lock, Plus, Trash2, Webhook } from "lucide-react"
import { api } from "@/lib/api"
import type { Contract } from "@/lib/types"
import { Badge, Btn, ErrorNote, Panel, fmtDateTime, inputCls } from "@/components/sla/ui"
import { WebhookIntro, WebhookSetupSteps } from "@/components/contracts/webhook-guide"

type HookParty = "BUYER" | "SUPPLIER"
type LastProbe = { isUp: boolean; detail: string; latencyMs: number | null; at: string } | null
type Source = { id: string; sourceType: "HTTP_CHECK" | "WEBHOOK"; endpointUrl: string | null; party: HookParty | null; paused: boolean; lastProbedAt: string | null; createdAt: string; last?: LastProbe }

const HOOK_NAME: Record<HookParty, string> = { BUYER: "Webhook client", SUPPLIER: "Webhook provider" }
type SourcesRes = { sources: Source[]; maxSources: number | null; planName: string; planActive: boolean; pausedByAdmin?: boolean; penaltyHold?: boolean }
const KPI_NAME: Record<string, string> = { UPTIME: "Uptime", RESPONSE_TIME: "Thời gian phản hồi", FIRST_RESPONSE: "Phản hồi ticket", RESOLUTION_TIME: "Xử lý ticket", INCIDENT_RESPONSE: "Ứng phó sự cố" }

// Nguồn dữ liệu cho Oracle: URL HTTP Health Check (điều khoản: chỉ sửa khi chờ ký, ký đủ thì khoá và ghi lên chain)
// + mỗi bên 1 địa chỉ webhook (client = bên mua, provider = nhà cung cấp), dùng cho KPI chọn nguồn Webhook.
// KPI nguồn Webhook tính theo: webhook client > webhook provider > SMART-SLA. SMART-SLA luôn đo song song để đối chiếu.
export default function MonitoringPanel({ contract, party, onChanged }: { contract: Contract; party: HookParty; onChanged: () => void }) {
  const [data, setData] = useState<SourcesRes | null>(null)
  const [url, setUrl] = useState("")
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await api<SourcesRes>(`/api/contracts/${contract.id}/oracle`))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được nguồn dữ liệu")
    }
  }, [contract.id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    setInfo(null)
    try {
      await fn()
      await load()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Có lỗi xảy ra")
    } finally {
      setBusy(null)
    }
  }

  const sources = data?.sources ?? []
  const httpSources = sources.filter((s) => s.sourceType === "HTTP_CHECK")
  const hooks = sources.filter((s) => s.sourceType === "WEBHOOK")
  const hook = hooks.find((s) => s.party === party)
  const pending = contract.status === "PENDING_SIGNATURE"
  const someoneSigned = (contract.signatures ?? []).some((s) => s.signedAt)
  const hookKpis = (contract.kpis ?? []).filter((k) => k.dataSource === "WEBHOOK")
  const uptimeByHook = hookKpis.some((k) => k.kpiCode === "UPTIME")
  const kpiSource = !uptimeByHook ? null : hooks.find((s) => s.party === "BUYER") ? "BUYER" : hooks.find((s) => s.party === "SUPPLIER") ? "SUPPLIER" : null
  const full = data?.maxSources !== null && data?.maxSources !== undefined && sources.length >= data.maxSources

  const addHttp = () =>
    run("http", async () => {
      const r = await api<{ signaturesReset?: boolean }>(`/api/contracts/${contract.id}/oracle`, { method: "POST", body: { sourceType: "HTTP_CHECK", endpointUrl: url.trim() } })
      setUrl("")
      setInfo(`Đã thêm URL giám sát.${r.signaturesReset ? " Chữ ký trước đó đã bị huỷ, hai bên cần ký lại." : ""}`)
    })

  const makeWebhook = () =>
    run("hook", async () => {
      const r = await api<{ webhookUrl: string }>(`/api/contracts/${contract.id}/oracle`, { method: "POST", body: { sourceType: "WEBHOOK" } })
      setWebhookUrl(r.webhookUrl)
    })

  const remove = (s: Source) => run(`rm-${s.id}`, async () => void (await api(`/api/contracts/${contract.id}/oracle/${s.id}`, { method: "DELETE" })))

  return (
    <Panel title="Nguồn dữ liệu giám sát">
      <p className="text-sm text-slate-300">
        Đang dùng <strong className="text-white">{sources.length}</strong>
        {data?.maxSources !== null && data?.maxSources !== undefined ? <>/{data.maxSources}</> : null} nguồn
        {data && <> theo gói <strong className="text-white">{data.planName}</strong></>}.{" "}
        {full && <Link href="/pricing" className="font-semibold text-blue-300 hover:text-blue-200">Nâng cấp gói để thêm nguồn</Link>}
      </p>
      {data?.pausedByAdmin && <p className="mt-2 text-xs text-amber-300">Admin SMART-SLA đang tạm dừng giám sát hợp đồng này (tự bật lại khi xử lý xong).</p>}
      {data?.penaltyHold && <p className="mt-2 text-xs text-amber-300">Đang có khiếu nại chờ admin xử lý: SMART-SLA vẫn đo bình thường, tạm giữ việc mở vụ phạt mới.</p>}
      <p className="mt-2 text-xs text-slate-400">
        KPI dùng webhook: {hookKpis.length ? <strong className="text-slate-200">{hookKpis.map((k) => KPI_NAME[k.kpiCode] ?? k.kpiCode).join(", ")}</strong> : "không có (chỉ SMART-SLA tự đo)"}.
      </p>

      {/* Danh sách nguồn */}
      {sources.length > 0 && (
        <ul className="mt-4 space-y-2">
          {sources.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700/80 px-3 py-2.5 text-sm">
              {s.sourceType === "WEBHOOK" ? <Webhook className="h-4 w-4 text-cyan-300" /> : <Globe className="h-4 w-4 text-blue-300" />}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 truncate font-semibold text-white">
                  {s.sourceType === "WEBHOOK" ? `${HOOK_NAME[s.party ?? "SUPPLIER"]}${s.party === party ? " (của bạn)" : ""}` : s.endpointUrl}
                  {s.sourceType === "WEBHOOK" && s.party === kpiSource && <Badge tone="violet">Đang dùng tính Uptime</Badge>}
                  {s.sourceType === "HTTP_CHECK" && !pending && <Lock className="h-3.5 w-3.5 text-slate-400" aria-label="Đã khoá" />}
                  {s.sourceType === "HTTP_CHECK" && (kpiSource ? <Badge tone="slate">Đối chiếu</Badge> : <Badge tone="blue">Đang dùng tính Uptime</Badge>)}
                </p>
                <p className="text-xs text-slate-400">
                  Thêm lúc {fmtDateTime(s.createdAt)}
                  {s.sourceType === "HTTP_CHECK" && ` · đo gần nhất ${s.lastProbedAt ? fmtDateTime(s.lastProbedAt) : "chưa có"}`}
                </p>
                {s.sourceType === "HTTP_CHECK" && s.last && (
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={s.last.isUp ? "green" : "red"}>{s.last.isUp ? "UP" : "DOWN"}</Badge>
                    <span className="text-slate-300">{s.last.detail}{s.last.latencyMs !== null ? ` · ${s.last.latencyMs}ms` : ""}</span>
                    {!s.last.isUp && /HTTP 404|HTTP 405/.test(s.last.detail) && <span className="text-rose-300">URL không đúng: địa chỉ này không trả lời yêu cầu kiểm tra (GET)</span>}
                  </p>
                )}
              </div>
              {s.paused && <Badge tone="amber">Tạm dừng</Badge>}
              {((s.sourceType === "HTTP_CHECK" && pending) || (s.sourceType === "WEBHOOK" && s.party === party)) && <button type="button" onClick={() => remove(s)} disabled={busy === `rm-${s.id}`} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-700 text-slate-400 hover:text-rose-300 disabled:opacity-50" aria-label="Gỡ nguồn này">
                <Trash2 className="h-4 w-4" />
              </button>}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {/* HTTP Health Check */}
        <div className="rounded-xl border border-slate-700/80 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-white"><Globe className="h-4 w-4 text-blue-300" />HTTP Health Check</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">URL health check của dịch vụ nhà cung cấp, hai bên thống nhất. SMART-SLA tự gọi URL này để đo uptime và thời gian phản hồi. URL hợp lệ: địa chỉ công khai của dịch vụ, bắt đầu bằng https://, mở bằng trình duyệt ra trang hoặc dữ liệu bình thường (không lỗi 404/500). SMART-SLA gọi thử ngay khi bạn lưu. Không dán địa chỉ webhook vào đây. Khi demo, dùng https://shadow-byte-ctwf.onrender.com/api/demo-provider/health.</p>
          {pending ? (
            <>
              <div className="mt-3 flex gap-2">
                <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.congty.vn/health" className={inputCls} aria-label="URL cần giám sát" />
                <Btn onClick={addHttp} loading={busy === "http"} disabled={!url.trim() || full}><Plus className="h-4 w-4" />Thêm</Btn>
              </div>
              {someoneSigned && <p className="mt-2 text-[11px] text-amber-300">Đã có bên ký: thêm hoặc gỡ URL sẽ huỷ chữ ký, hai bên phải ký lại.</p>}
            </>
          ) : (
            <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-slate-800/40 px-3 py-2 text-[11px] leading-5 text-slate-300">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Hợp đồng đã ký đủ: URL giám sát là điều khoản đã ghi trên blockchain nên không thêm, gỡ được nữa.
            </p>
          )}
          <p className="mt-2 text-[11px] text-slate-500">{httpSources.length} URL đang giám sát</p>
        </div>

        {/* Webhook */}
        <div className="rounded-xl border border-slate-700/80 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-white"><Webhook className="h-4 w-4 text-cyan-300" />{HOOK_NAME[party]} <span className="text-xs font-normal text-slate-400">(của bạn)</span></p>
          <div className="mt-1"><WebhookIntro /></div>
          <Btn className="mt-3" variant={hook ? "ghost" : "primary"} onClick={makeWebhook} loading={busy === "hook"} disabled={!hook && full}>
            {hook ? "Tạo lại địa chỉ (đổi mã bí mật)" : "Tạo địa chỉ nhận dữ liệu (webhook)"}
          </Btn>
          {hook && !webhookUrl && <p className="mt-2 text-[11px] text-slate-500">Đã có {HOOK_NAME[party].toLowerCase()}. Mã bí mật chỉ hiển thị một lần lúc tạo; tạo lại sẽ vô hiệu địa chỉ cũ.</p>}
          {hooks.length > 0 && httpSources.length === 0 && (
            <p className="mt-2 text-[11px] text-amber-300">Nên thêm 1 URL HTTP Health Check để SMART-SLA đo độc lập, đối chiếu với webhook.</p>
          )}
          {webhookUrl && (
            <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
              <p className="font-semibold">Lưu lại địa chỉ này ngay, mã bí mật chỉ hiển thị một lần:</p>
              <input readOnly value={webhookUrl} onFocus={(e) => e.currentTarget.select()} className={`${inputCls} mt-2 font-mono text-xs`} aria-label="Địa chỉ webhook" />
              <Btn variant="ghost" className="mt-2" onClick={() => navigator.clipboard?.writeText(webhookUrl)}>Sao chép</Btn>
              <div className="mt-3"><WebhookSetupSteps /></div>
            </div>
          )}
        </div>
      </div>

      {info && <p className="mt-3 text-xs text-emerald-300" role="status">{info}</p>}
      <div className="mt-3"><ErrorNote message={error} /></div>
    </Panel>
  )
}

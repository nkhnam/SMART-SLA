"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import AppShell from "@/components/ui/app-shell"
import KpiEditor, { rowsToKpis, toRow, type KpiRow } from "@/components/contracts/kpi-editor"
import ConditionsEditor, { hasEmptyCondition } from "@/components/contracts/conditions-editor"
import ContractTermsFields, { termsBody, termsError, type TermsValue } from "@/components/contracts/contract-terms-fields"
import { oneYearLater, todayVn } from "@/lib/terms"
import { api } from "@/lib/api"
import { getSession, useSession } from "@/lib/session"
import type { Catalog, Contract, ServiceListing } from "@/lib/types"
import { Btn, ErrorNote, Field, Loading, Panel, inputCls } from "@/components/sla/ui"
import { WebhookIntro, WebhookSetupSteps } from "@/components/contracts/webhook-guide"

export default function CreateSlaPage() {
  const router = useRouter()
  const { user } = useSession()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [templateCode, setTemplateCode] = useState<string | null>(null)
  const [counterpart, setCounterpart] = useState("")
  const [service, setService] = useState("")
  const [contractName, setContractName] = useState("")
  const [challengeHours, setChallengeHours] = useState("72")
  const [conditions, setConditions] = useState<string[]>([])
  const [terms, setTerms] = useState<TermsValue>(() => {
    const from = todayVn()
    return { value: "", from, to: oneYearLater(from) }
  })
  const [monitorUrl, setMonitorUrl] = useState("")
  const [makeWebhook, setMakeWebhook] = useState(false)
  // Tạo xong mà có webhook: hiện địa chỉ 1 lần trước khi chuyển trang
  const [done, setDone] = useState<{ id: string; webhookUrl: string } | null>(null)
  const [rows, setRows] = useState<KpiRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Tạo từ dịch vụ trên Marketplace (/create-sla?listing=<id>)
  const [fromListing, setFromListing] = useState<ServiceListing | null>(null)

  const iAmSupplier = user?.organization.orgType === "SUPPLIER"
  const useWebhook = rows.some((r) => r.dataSource === "WEBHOOK")

  useEffect(() => {
    api<Catalog>("/api/sla-builder/catalog")
      .then(async (c) => {
        setCatalog(c)
        const listingId = new URLSearchParams(window.location.search).get("listing")
        if (listingId) {
          try {
            applyListing(await api<ServiceListing>(`/api/listings/${listingId}`))
            return
          } catch (err) {
            setLoadError(err instanceof Error ? `Không tải được dịch vụ đã chọn: ${err.message}` : "Không tải được dịch vụ đã chọn")
          }
        }
        const first = c.templates[0]
        if (first) applyTemplate(first.code, c)
      })
      .catch((err) => setLoadError(err.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Dịch vụ trên Marketplace dùng làm mẫu: bên mua thấy mọi dịch vụ đã duyệt, nhà cung cấp thấy dịch vụ đã duyệt của mình
  const [listings, setListings] = useState<ServiceListing[]>([])
  useEffect(() => {
    if (!user) return
    const url = user.organization.orgType === "SUPPLIER" ? "/api/listings/mine" : "/api/listings"
    api<ServiceListing[]>(url)
      .then((ls) => setListings(ls.filter((l) => l.status === "APPROVED")))
      .catch(() => setListings([]))
  }, [user])

  function applyListing(l: ServiceListing) {
    setFromListing(l)
    setTemplateCode(null)
    // Bên mua: bên kia là nhà cung cấp của dịch vụ. Nhà cung cấp: tự nhập tên bên mua
    const supplier = (user ?? getSession()?.user)?.organization.orgType === "SUPPLIER"
    setCounterpart(supplier ? "" : l.provider?.name ?? "")
    setService(l.title)
    setChallengeHours(String(l.challengeWindowHours))
    setRows(l.kpis.map(toRow))
    setConditions(l.additionalConditions ?? [])
  }

  function applyTemplate(code: string, c: Catalog | null = catalog) {
    const tpl = c?.templates.find((t) => t.code === code)
    if (!tpl) return
    setFromListing(null)
    setTemplateCode(code)
    setService(tpl.serviceName)
    setChallengeHours(String(tpl.challengeWindowHours))
    setRows(tpl.kpis.map(toRow))
    setConditions(tpl.conditions ?? [])
  }

  const submit = async () => {
    setError(null)
    if (!counterpart.trim()) return setError(iAmSupplier ? "Nhập tên bên mua dịch vụ." : "Nhập tên nhà cung cấp.")
    const tErr = termsError(terms)
    if (tErr) return setError(tErr)
    if (rows.length === 0) return setError("Hợp đồng cần ít nhất 1 KPI.")
    if (hasEmptyCondition(conditions)) return setError("Hãy điền nội dung hoặc xoá điều kiện bổ sung còn trống.")
    setSubmitting(true)
    try {
      const body = {
        ...(iAmSupplier ? { client: counterpart.trim() } : { provider: counterpart.trim() }),
        service: service.trim(),
        contractName: contractName.trim() || undefined,
        templateCode,
        challengeWindowHours: Number(challengeHours),
        monitorUrl: monitorUrl.trim() || undefined,
        createWebhook: makeWebhook && useWebhook,
        kpis: rowsToKpis(rows, catalog!),
        additionalConditions: conditions.map((c) => c.trim()),
        ...termsBody(terms),
      }
      const created = await api<Contract & { webhookUrl?: string | null }>("/api/contracts/create", { method: "POST", body, timeoutMs: 120_000 })
      if (created.webhookUrl) {
        setDone({ id: created.id, webhookUrl: created.webhookUrl })
        setSubmitting(false)
      } else router.push(`/contracts/${created.id}`)
    } catch (err) {
      // KHÔNG lưu tạm hay báo thành công giả: hợp đồng chỉ tồn tại khi backend đã tạo xong
      setError(err instanceof Error ? err.message : "Không tạo được hợp đồng")
      setSubmitting(false)
    }
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-white">Tạo hợp đồng SLA</h1>
        <p className="mt-2 text-sm text-slate-400">Chọn mẫu theo ngành rồi chỉnh từng KPI. Toàn bộ điều khoản được băm và ghi dấu trên Polygon.</p>

        {loadError && <div className="mt-6"><ErrorNote message={loadError} /></div>}
        {!catalog && !loadError && <Loading />}

        {catalog && (
          <div className="mt-8 space-y-6">
            {fromListing && (
              <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                Tạo hợp đồng từ dịch vụ <strong>{fromListing.title}</strong>{fromListing.provider?.name ? <> của <strong>{fromListing.provider.name}</strong></> : null} trên Marketplace. Điều khoản đã được điền sẵn, bạn có thể chỉnh trước khi tạo. Sau khi tạo, hai bên vẫn bàn bạc và sửa được cho tới khi cùng ký.
              </div>
            )}
            {listings.length > 0 && (
              <Panel title={iAmSupplier ? "Dịch vụ của bạn trên Marketplace" : "Dịch vụ trên Marketplace"}>
                <p className="-mt-1 mb-3 text-xs text-slate-400">
                  {iAmSupplier
                    ? "Chọn dịch vụ đã được duyệt để dùng làm mẫu hợp đồng, rồi nhập tên bên mua."
                    : "Chọn dịch vụ đã được SMART-SLA duyệt: điều khoản và nhà cung cấp được điền sẵn theo dịch vụ."}
                </p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {listings.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => applyListing(l)}
                      aria-pressed={fromListing?.id === l.id}
                      className={`rounded-xl border p-4 text-left transition ${fromListing?.id === l.id ? "border-blue-500 bg-blue-500/10" : "border-slate-700 hover:border-slate-500"}`}
                    >
                      <p className="truncate text-sm font-bold text-white">{l.title}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-400">{l.provider?.name ? `${l.provider.name} · ` : ""}{l.category}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-400">{l.kpis.map((k) => k.name).join(", ")}</p>
                      {l.priceNote && <p className="mt-1 truncate text-xs font-semibold text-emerald-300">{l.priceNote}</p>}
                    </button>
                  ))}
                </div>
              </Panel>
            )}
            <Panel title="Mẫu theo ngành">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {catalog.templates.map((t) => (
                  <button
                    key={t.code}
                    type="button"
                    onClick={() => applyTemplate(t.code)}
                    aria-pressed={templateCode === t.code}
                    className={`rounded-xl border p-4 text-left transition ${templateCode === t.code ? "border-blue-500 bg-blue-500/10" : "border-slate-700 hover:border-slate-500"}`}
                  >
                    <span className="text-2xl" aria-hidden="true">{t.icon}</span>
                    <p className="mt-2 text-sm font-bold text-white">{t.name}</p>
                    <p className="mt-1 text-xs text-slate-400">{t.kpis.map((k) => k.name).join(", ")}</p>
                  </button>
                ))}
              </div>
            </Panel>

            <Panel title="Thông tin hợp đồng">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={iAmSupplier ? "Bên mua dịch vụ" : "Nhà cung cấp"} hint="Nhập đúng tên doanh nghiệp bên kia đã đăng ký trên SMART-SLA (phân biệt chữ hoa và chữ thường) để họ thấy hợp đồng và ký được">
                  <input value={counterpart} onChange={(e) => setCounterpart(e.target.value)} placeholder={iAmSupplier ? "Công ty ABC Logistics" : "Công ty XYZ Cloud"} className={inputCls} />
                </Field>
                <Field label="Tên hợp đồng (tuỳ chọn)" hint="Tên dễ nhớ để quản lý và tìm kiếm, đổi được bất cứ lúc nào">
                  <input value={contractName} maxLength={120} onChange={(e) => setContractName(e.target.value)} placeholder="VD: Hosting website bán hàng 2026" className={inputCls} />
                </Field>
                <Field label="Dịch vụ">
                  <input value={service} onChange={(e) => setService(e.target.value)} className={inputCls} />
                </Field>
                <ContractTermsFields value={terms} onChange={setTerms} />
                <Field label="Thời hạn phản đối (giờ)" hint="Từ 24 đến 168 giờ (khuyến nghị 72 giờ để không lỡ hạn vào cuối tuần). Hai bên được phản đối kết quả trong thời gian này">
                  <input type="number" min={24} max={168} value={challengeHours} onChange={(e) => setChallengeHours(e.target.value)} className={inputCls} />
                </Field>
                <Field
                  label="URL dịch vụ cần giám sát"
                  hint="Địa chỉ kiểm tra sức khoẻ (health check) của dịch vụ nhà cung cấp, hai bên cần thống nhất. SMART-SLA tự gọi URL này để đo uptime và thời gian phản hồi. URL hợp lệ: địa chỉ công khai của dịch vụ, bắt đầu bằng https://, mở bằng trình duyệt ra trang hoặc dữ liệu bình thường (không lỗi 404/500). SMART-SLA gọi thử ngay khi bạn lưu. Không dán địa chỉ webhook vào đây. Khi demo, dùng https://shadow-byte-ctwf.onrender.com/api/demo-provider/health. URL là điều khoản: sửa được khi còn chờ ký (sửa sẽ huỷ chữ ký đã có), ký đủ thì khoá và ghi lên blockchain"
                >
                  <input type="url" value={monitorUrl} onChange={(e) => setMonitorUrl(e.target.value)} placeholder="https://api.congty.vn/health" className={inputCls} />
                </Field>
              </div>
            </Panel>

            <KpiEditor catalog={catalog} rows={rows} setRows={setRows} />
            {useWebhook && (
              <Panel title="Webhook (địa chỉ nhận dữ liệu)">
                <WebhookIntro />
                <p className="mt-2 text-xs leading-5 text-slate-400">Bên kia tạo webhook của họ ở trang hợp đồng, mục <strong className="text-slate-200">Nguồn dữ liệu giám sát</strong>.</p>
                <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-white">
                  <input type="checkbox" checked={makeWebhook} onChange={(e) => setMakeWebhook(e.target.checked)} className="h-4 w-4" />
                  Tạo luôn địa chỉ nhận dữ liệu của tôi ({iAmSupplier ? "webhook provider" : "webhook client"}), hiện ra sau khi tạo hợp đồng
                </label>
              </Panel>
            )}
            <ConditionsEditor conditions={conditions} setConditions={setConditions} suggestions={fromListing ? fromListing.additionalConditions : catalog.templates.find((t) => t.code === templateCode)?.conditions} />

            <ErrorNote message={error} />
            <div className="flex items-center justify-end gap-3">
              {submitting && <span className="text-xs text-slate-400">Đang tạo hợp đồng và ghi dấu lên Polygon, có thể mất tới 1 phút…</span>}
              <Btn onClick={submit} loading={submitting}>Tạo hợp đồng</Btn>
            </div>
          </div>
        )}
        {done && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Địa chỉ webhook">
            <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-[#0b1424] p-6 shadow-2xl">
              <p className="text-lg font-bold text-white">Đã tạo hợp đồng</p>
              <p className="mt-2 text-sm text-amber-200">Địa chỉ webhook của bạn (mã bí mật chỉ hiển thị một lần, hãy lưu lại ngay):</p>
              <input readOnly value={done.webhookUrl} onFocus={(e) => e.currentTarget.select()} className={`${inputCls} mt-3 font-mono text-xs`} aria-label="Địa chỉ webhook" />
              <div className="mt-4 text-slate-300"><WebhookSetupSteps /></div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Btn variant="ghost" onClick={() => navigator.clipboard?.writeText(done.webhookUrl)}>Sao chép</Btn>
                <Btn onClick={() => router.push(`/contracts/${done.id}`)}>Đến hợp đồng</Btn>
              </div>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  )
}

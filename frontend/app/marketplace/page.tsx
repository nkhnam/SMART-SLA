"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { BadgeCheck, Plus, Search, X } from "lucide-react"
import AppShell from "@/components/ui/app-shell"
import { api, polygonscanTx } from "@/lib/api"
import { Badge, Btn, Empty, ErrorNote, Loading, StatusBadge, fmtDateTime, fmtPercent, inputCls } from "@/components/sla/ui"
import { useSession } from "@/lib/session"
import type { ServiceListing } from "@/lib/types"
import ListingDetail, { LISTING_STATUS, kpiLine } from "@/components/marketplace/listing-detail"
import ListingEditor from "@/components/marketplace/listing-editor"

type Profile = {
  score: number | null
  performanceVerified: boolean
  status: string
  metrics: { periodDays: number; uptime: number | null; avgLatencyMs: number | null; probes: number; minProbesRequired: number }
  components: { reliability: number | null; compliance: number; responsiveness: number | null }
  violations: { periodDays: number; settled: number; challenged: number; pending: number; dismissed?: number }
  contracts: { total: number; active: number; onChain: number }
}
type Provider = { id: string; name: string; serviceType: string; description: string | null; website: string | null; hasAccount: boolean; profile: Profile }
type Detail = Provider & {
  recentViolations: { kpiCode: string; targetValue: number; actualValue: number; creditBps: number; status: string; createdAt: string; recordTxHash: string | null }[]
}

const scoreColor = (s: number | null) => (s === null ? "text-slate-400" : s >= 85 ? "text-emerald-300" : s >= 60 ? "text-amber-300" : "text-rose-300")

function DetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api<Detail>(`/api/marketplace/providers/${id}`).then(setD).catch((e) => setError(e.message))
  }, [id])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label="Hồ sơ hiệu suất" onClick={onClose}>
      <aside className="h-full w-full max-w-lg overflow-y-auto border-l border-slate-700 bg-[#0b1424] p-6" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="float-right text-slate-400 hover:text-white" aria-label="Đóng"><X className="h-5 w-5" /></button>
        <ErrorNote message={error} />
        {!d && !error && <Loading />}
        {d && (
          <>
            <h2 className="text-2xl font-extrabold text-white">{d.name}</h2>
            <p className="mt-1 text-sm text-slate-400">{d.serviceType}</p>
            {d.description && <p className="mt-3 text-sm leading-6 text-slate-300">{d.description}</p>}
            {d.website && <a href={d.website} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-blue-300">{d.website}</a>}

            <div className="mt-6 rounded-xl border border-slate-700 p-4">
              <p className="text-xs text-slate-400">Điểm uy tín</p>
              <p className={`text-4xl font-extrabold ${scoreColor(d.profile.score)}`}>{d.profile.score ?? "—"}</p>
              <p className="mt-1 text-xs text-slate-400">{d.profile.status}</p>
              <dl className="mt-4 grid grid-cols-3 gap-3 text-center text-xs">
                <div><dt className="text-slate-500">Ổn định (50%)</dt><dd className="mt-1 text-lg font-bold text-white">{d.profile.components.reliability ?? "—"}</dd></div>
                <div><dt className="text-slate-500">Tuân thủ (35%)</dt><dd className="mt-1 text-lg font-bold text-white">{d.profile.components.compliance}</dd></div>
                <div><dt className="text-slate-500">Phản hồi (15%)</dt><dd className="mt-1 text-lg font-bold text-white">{d.profile.components.responsiveness ?? "—"}</dd></div>
              </dl>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-slate-800 p-3"><dt className="text-xs text-slate-500">Uptime {d.profile.metrics.periodDays} ngày</dt><dd className="font-bold text-white">{d.profile.metrics.uptime ?? "—"}{d.profile.metrics.uptime !== null && "%"}</dd></div>
              <div className="rounded-lg border border-slate-800 p-3"><dt className="text-xs text-slate-500">Phản hồi trung bình</dt><dd className="font-bold text-white">{d.profile.metrics.avgLatencyMs ?? "—"}{d.profile.metrics.avgLatencyMs !== null && "ms"}</dd></div>
              <div className="rounded-lg border border-slate-800 p-3"><dt className="text-xs text-slate-500">Số lần đo</dt><dd className="font-bold text-white">{d.profile.metrics.probes}</dd></div>
              <div className="rounded-lg border border-slate-800 p-3"><dt className="text-xs text-slate-500">Hợp đồng ghi on-chain</dt><dd className="font-bold text-white">{d.profile.contracts.onChain}/{d.profile.contracts.total}</dd></div>
            </dl>

            <h3 className="mt-6 text-sm font-bold text-white">Vi phạm gần đây (ẩn danh bên mua)</h3>
            {d.recentViolations.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">Không có vi phạm.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {d.recentViolations.map((v, i) => (
                  <li key={i} className="rounded-lg border border-slate-800 p-3 text-xs text-slate-300">
                    <div className="flex items-center justify-between gap-2"><span>{v.kpiCode}: {v.actualValue} / cam kết {v.targetValue}</span><StatusBadge status={v.status} kind="violation" /></div>
                    <p className="mt-1 text-slate-500">{fmtDateTime(v.createdAt)} · hoàn {fmtPercent(v.creditBps)}{v.recordTxHash && <> · <a href={polygonscanTx(v.recordTxHash)!} target="_blank" rel="noreferrer" className="text-blue-300">bằng chứng</a></>}</p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </aside>
    </div>
  )
}


// Drawer xem chi tiết 1 dịch vụ (+ hồ sơ uy tín của nhà cung cấp)
function ListingDrawer({ listing, provider, canUse, onUse, onShowProvider, onClose }: {
  listing: ServiceListing
  provider?: Provider
  canUse: boolean
  onUse: () => void
  onShowProvider: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label="Chi tiết dịch vụ" onClick={onClose}>
      <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-700 bg-[#0b1424] p-6" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="float-right text-slate-400 hover:text-white" aria-label="Đóng"><X className="h-5 w-5" /></button>
        <ListingDetail listing={listing} />
        {provider && (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-slate-700 p-4">
            <div>
              <p className="text-xs text-slate-400">Điểm uy tín của {provider.name}</p>
              <p className={`text-3xl font-extrabold ${scoreColor(provider.profile.score)}`}>{provider.profile.score ?? "—"}</p>
              <p className="text-xs text-slate-500">{provider.profile.status}</p>
            </div>
            <Btn variant="ghost" onClick={onShowProvider}>Xem hồ sơ uy tín</Btn>
          </div>
        )}
        {canUse && <Btn className="mt-5 w-full" onClick={onUse}>Sử dụng dịch vụ</Btn>}
      </aside>
    </div>
  )
}

// Tab "Các dịch vụ": dịch vụ đã được admin duyệt
function ServicesTab() {
  const router = useRouter()
  const { user } = useSession()
  const [listings, setListings] = useState<ServiceListing[] | null>(null)
  const [providers, setProviders] = useState<Record<string, Provider>>({})
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [open, setOpen] = useState<ServiceListing | null>(null)
  const [providerId, setProviderId] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api<ServiceListing[]>("/api/listings"), api<Provider[]>("/api/marketplace/providers")])
      .then(([ls, ps]) => {
        setListings(ls)
        setProviders(Object.fromEntries(ps.map((p) => [p.id, p])))
      })
      .catch((e) => setError(e.message))
  }, [])

  const list = useMemo(() => {
    const k = q.trim().toLowerCase()
    return (listings ?? []).filter((l) => !k || [l.title, l.category, l.provider?.name ?? ""].some((v) => v.toLowerCase().includes(k)))
  }, [listings, q])

  // Chỉ bên mua mới thuê dịch vụ -> mở trang Tạo SLA đã điền sẵn
  const canUse = user?.organization.orgType === "BUYER"
  const use = (l: ServiceListing) => router.push(`/create-sla?listing=${l.id}`)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-400">Dịch vụ đã được SLA-DEX kiểm duyệt. Điểm uy tín tính từ dữ liệu đo thật, nhà cung cấp không tự sửa được.</p>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm dịch vụ, danh mục, nhà cung cấp" className={`${inputCls} pl-9`} aria-label="Tìm dịch vụ" />
        </div>
      </div>
      <div className="mt-6">
        <ErrorNote message={error} />
        {!listings && !error && <Loading />}
        {listings && list.length === 0 && <Empty>Chưa có dịch vụ nào được duyệt.</Empty>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((l) => {
            const p = providers[l.providerId]
            return (
              <article key={l.id} className="flex flex-col rounded-2xl border border-slate-700/70 bg-[#0b1424]/85 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-bold text-white">{l.title}</p>
                    <p className="truncate text-xs text-slate-400">{l.provider?.name} · {l.category}</p>
                  </div>
                  <p className={`text-2xl font-extrabold ${scoreColor(p?.profile.score ?? null)}`} title="Điểm uy tín">{p?.profile.score ?? "—"}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {l.featured && <Badge tone="violet">Đối tác nổi bật</Badge>}
                  {p?.profile.performanceVerified ? <Badge tone="green"><BadgeCheck className="h-3 w-3" />Verified Performance</Badge> : <Badge>{p?.profile.status ?? "Đang thu thập dữ liệu"}</Badge>}
                </div>
                {l.priceNote && <p className="mt-3 text-sm font-semibold text-emerald-300">{l.priceNote}</p>}
                <ul className="mt-3 space-y-1 text-xs text-slate-300">
                  {l.kpis.slice(0, 3).map((k) => <li key={k.kpiCode}>• {kpiLine(k)}</li>)}
                </ul>
                <div className="mt-auto flex gap-2 pt-4">
                  <Btn variant="ghost" className="flex-1" onClick={() => setOpen(l)}>Chi tiết</Btn>
                  {canUse && <Btn className="flex-1" onClick={() => use(l)}>Sử dụng dịch vụ</Btn>}
                </div>
              </article>
            )
          })}
        </div>
        {listings && !canUse && <p className="mt-4 text-xs text-slate-500">Chỉ tài khoản bên mua dịch vụ mới chọn “Sử dụng dịch vụ”.</p>}
      </div>
      {open && (
        <ListingDrawer
          listing={open}
          provider={providers[open.providerId]}
          canUse={canUse}
          onUse={() => use(open)}
          onShowProvider={() => { setProviderId(open.providerId); setOpen(null) }}
          onClose={() => setOpen(null)}
        />
      )}
      {providerId && <DetailDrawer id={providerId} onClose={() => setProviderId(null)} />}
    </>
  )
}

// Tab "Quản lý dịch vụ" (chỉ nhà cung cấp)
function ManageTab() {
  const router = useRouter()
  const [mine, setMine] = useState<ServiceListing[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ServiceListing | "new" | null>(null)
  const [preview, setPreview] = useState<ServiceListing | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    api<ServiceListing[]>("/api/listings/mine").then(setMine).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const submit = async (id: string) => {
    setBusy(id)
    setError(null)
    try {
      await api(`/api/listings/${id}/submit`, { method: "POST" })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không gửi duyệt được")
    } finally {
      setBusy(null)
    }
  }

  if (editing) {
    return <ListingEditor listing={editing === "new" ? null : editing} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); load() }} />
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-400">Dịch vụ chỉ hiển thị trên Marketplace sau khi admin SLA-DEX duyệt.</p>
        <Btn onClick={() => setEditing("new")}><Plus className="h-4 w-4" />Tạo dịch vụ mới</Btn>
      </div>
      <div className="mt-6 space-y-3">
        <ErrorNote message={error} />
        {!mine && !error && <Loading />}
        {mine && mine.length === 0 && <Empty>Bạn chưa có dịch vụ nào. Bấm “Tạo dịch vụ mới” để bắt đầu.</Empty>}
        {mine?.map((l) => (
          <article key={l.id} className="rounded-2xl border border-slate-700/70 bg-[#0b1424]/85 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-bold text-white">{l.title}</p>
                <p className="text-xs text-slate-400">{l.category} · cập nhật {fmtDateTime(l.updatedAt)}</p>
              </div>
              <Badge tone={LISTING_STATUS[l.status].tone}>{LISTING_STATUS[l.status].label}</Badge>
            </div>
            {l.status === "REJECTED" && l.rejectReason && (
              <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">Lý do từ chối: {l.rejectReason}</p>
            )}
            {l.status === "PENDING" && <p className="mt-3 text-xs text-amber-300">Đang chờ admin SLA-DEX duyệt.</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Btn variant="ghost" onClick={() => setPreview(l)}>Xem trước</Btn>
              <Btn variant="ghost" onClick={() => setEditing(l)}>Sửa</Btn>
              {(l.status === "DRAFT" || l.status === "REJECTED") && <Btn onClick={() => submit(l.id)} loading={busy === l.id}>Gửi duyệt</Btn>}
              {l.status === "APPROVED" && <Btn onClick={() => router.push(`/create-sla?listing=${l.id}`)}>Tạo hợp đồng từ dịch vụ này</Btn>}
            </div>
          </article>
        ))}
      </div>
      {preview && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label="Xem trước dịch vụ" onClick={() => setPreview(null)}>
          <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-700 bg-[#0b1424] p-6" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setPreview(null)} className="float-right text-slate-400 hover:text-white" aria-label="Đóng"><X className="h-5 w-5" /></button>
            <ListingDetail listing={preview} />
          </aside>
        </div>
      )}
    </>
  )
}

export default function MarketplacePage() {
  const { user } = useSession()
  const isSupplier = user?.organization.orgType === "SUPPLIER"
  // Mở thẳng tab quản lý từ thông báo (/marketplace?tab=manage)
  const [tab, setTab] = useState<"services" | "manage">(() =>
    typeof window !== "undefined" && window.location.search.includes("tab=manage") ? "manage" : "services",
  )

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-white">Marketplace</h1>
        <div className="mt-5 flex gap-2 border-b border-slate-800 pb-3" role="tablist" aria-label="Marketplace">
          <button type="button" role="tab" aria-selected={tab === "services"} onClick={() => setTab("services")} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === "services" ? "bg-blue-500/15 text-white" : "text-slate-400 hover:text-white"}`}>Các dịch vụ</button>
          {isSupplier && (
            <button type="button" role="tab" aria-selected={tab === "manage"} onClick={() => setTab("manage")} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === "manage" ? "bg-blue-500/15 text-white" : "text-slate-400 hover:text-white"}`}>Quản lý dịch vụ</button>
          )}
        </div>
        <div className="mt-6">{tab === "manage" && isSupplier ? <ManageTab /> : <ServicesTab />}</div>
      </main>
    </AppShell>
  )
}

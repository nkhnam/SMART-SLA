"use client"

import { useCallback, useEffect, useState } from "react"
import { X } from "lucide-react"
import AdminFrame from "@/components/admin/admin-frame"
import ListingDetail, { LISTING_STATUS } from "@/components/marketplace/listing-detail"
import { api } from "@/lib/api"
import { useSession } from "@/lib/session"
import type { ServiceListing } from "@/lib/types"
import { Badge, Btn, Empty, ErrorNote, Loading, fmtDateTime, inputCls } from "@/components/sla/ui"

const FILTERS = [
  { code: "PENDING", label: "Chờ duyệt" },
  { code: "APPROVED", label: "Đã duyệt" },
  { code: "REJECTED", label: "Bị từ chối" },
  { code: "ALL", label: "Tất cả" },
]

// Xem trước + duyệt / từ chối 1 dịch vụ
function ReviewDrawer({ listing, onClose, onDone }: { listing: ServiceListing; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("")
  const [rejecting, setRejecting] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const act = async (kind: "approve" | "reject") => {
    setBusy(kind)
    setError(null)
    try {
      await api(`/api/admin/listings/${listing.id}/${kind}`, { method: "POST", body: kind === "reject" ? { reason } : {} })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xử lý được")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label="Xem trước dịch vụ" onClick={onClose}>
      <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-700 bg-[#0b1424] p-6" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="float-right text-slate-400 hover:text-white" aria-label="Đóng"><X className="h-5 w-5" /></button>
        <ListingDetail listing={listing} />
        {listing.status === "REJECTED" && listing.rejectReason && <p className="mt-4 text-sm text-rose-300">Đã từ chối: {listing.rejectReason}</p>}

        {listing.status === "PENDING" && (
          <div className="mt-6 space-y-3 border-t border-slate-800 pt-5">
            {rejecting ? (
              <>
                <label className="block text-xs font-semibold text-slate-300">
                  Lý do từ chối (nhà cung cấp sẽ thấy)
                  <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="VD: Cam kết uptime chưa có khung bảo trì rõ ràng" className={`${inputCls} mt-1.5 h-auto py-2`} />
                </label>
                <div className="flex gap-2">
                  <Btn variant="danger" onClick={() => act("reject")} loading={busy === "reject"} disabled={!reason.trim()}>Xác nhận từ chối</Btn>
                  <Btn variant="ghost" onClick={() => setRejecting(false)}>Quay lại</Btn>
                </div>
              </>
            ) : (
              <div className="flex gap-2">
                <Btn onClick={() => act("approve")} loading={busy === "approve"}>Duyệt và đăng lên Marketplace</Btn>
                <Btn variant="danger" onClick={() => setRejecting(true)}>Từ chối</Btn>
              </div>
            )}
            <ErrorNote message={error} />
          </div>
        )}
      </aside>
    </div>
  )
}

export default function AdminListingsPage() {
  const { user } = useSession()
  const [status, setStatus] = useState("PENDING")
  const [rows, setRows] = useState<ServiceListing[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<ServiceListing | null>(null)

  const load = useCallback(() => {
    if (!user?.platformAdmin) return
    setRows(null)
    api<ServiceListing[]>(`/api/admin/listings?status=${status}`).then(setRows).catch((e) => setError(e.message))
  }, [user, status])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  return (
    <AdminFrame>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Lọc theo trạng thái">
        {FILTERS.map((f) => (
          <button key={f.code} type="button" role="radio" aria-checked={status === f.code} onClick={() => setStatus(f.code)} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${status === f.code ? "border-blue-500 bg-blue-500/15 text-white" : "border-slate-700 text-slate-400"}`}>
            {f.label}
          </button>
        ))}
      </div>
      <ErrorNote message={error} />
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && <Empty>Không có dịch vụ nào.</Empty>}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-700/70 bg-[#0b1424]/85 [scrollbar-color:#334155_transparent] [scrollbar-width:thin]">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-700/70 text-xs text-slate-400">
              <tr>
                <th className="px-4 py-3 font-semibold">Dịch vụ</th>
                <th className="px-4 py-3 font-semibold">Nhà cung cấp</th>
                <th className="px-4 py-3 font-semibold">Danh mục</th>
                <th className="px-4 py-3 font-semibold">Trạng thái</th>
                <th className="px-4 py-3 font-semibold">Gửi lúc</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-b border-slate-800 last:border-0 hover:bg-slate-800/40">
                  <td className="px-4 py-3 font-semibold text-white">{l.title}</td>
                  <td className="px-4 py-3 text-slate-300">{l.provider?.name}</td>
                  <td className="px-4 py-3 text-slate-300">{l.category}</td>
                  <td className="px-4 py-3"><Badge tone={LISTING_STATUS[l.status].tone}>{LISTING_STATUS[l.status].label}</Badge></td>
                  <td className="px-4 py-3 text-xs text-slate-400">{fmtDateTime(l.submittedAt)}</td>
                  <td className="px-4 py-3 text-right"><Btn variant="ghost" onClick={() => setOpen(l)}>{l.status === "PENDING" ? "Xem và duyệt" : "Xem"}</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <ReviewDrawer listing={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); load() }} />}
    </AdminFrame>
  )
}

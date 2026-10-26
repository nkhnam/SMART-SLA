"use client"

import { useCallback, useEffect, useState } from "react"
import AdminFrame from "@/components/admin/admin-frame"
import { api } from "@/lib/api"
import { useSession } from "@/lib/session"
import { Badge, Btn, Empty, ErrorNote, Loading, Panel, fmtDateTime } from "@/components/sla/ui"

type Tx = {
  id: string
  kind: "SUBSCRIPTION" | "PER_CONTRACT"
  planCode: string
  amountVnd: number
  status: string
  idempotencyKey: string
  description: string
  createdAt: string
  organization: { name: string }
}
type Revenue = { summary: { total: number; thisMonth: number; paidCount: number; pendingCount: number }; transactions: Tx[] }

const vnd = (n: number) => `${n.toLocaleString("vi-VN")} ₫`
const PLAN_NAME: Record<string, string> = { PILOT: "Pilot", PAYG: "Pay as you go", STARTER: "Starter", ENTERPRISE: "Enterprise" }

// Doanh thu (demo): tổng hợp + lịch sử giao dịch + nút gửi lại để chứng minh idempotency
export default function AdminRevenuePage() {
  const { user } = useSession()
  const [data, setData] = useState<Revenue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [replay, setReplay] = useState<{ id: string; message: string; ok: boolean } | null>(null)

  const load = useCallback(() => {
    if (!user?.platformAdmin) return
    api<Revenue>("/api/admin/revenue").then(setData).catch((e) => setError(e.message))
  }, [user])

  useEffect(() => {
    load()
  }, [load])

  const doReplay = async (t: Tx) => {
    setBusy(t.id)
    setReplay(null)
    try {
      const r = await api<{ newTransactions: number; message: string }>(`/api/admin/payments/${t.id}/replay`, { method: "POST" })
      setReplay({ id: t.id, message: r.message, ok: r.newTransactions === 0 })
      load()
    } catch (e) {
      setReplay({ id: t.id, message: e instanceof Error ? e.message : "Không gửi lại được", ok: false })
    } finally {
      setBusy(null)
    }
  }

  const cards = data
    ? [
        { label: "Doanh thu tháng này", value: vnd(data.summary.thisMonth) },
        { label: "Tổng doanh thu", value: vnd(data.summary.total) },
        { label: "Giao dịch thành công", value: String(data.summary.paidCount) },
        { label: "Chờ thanh toán", value: String(data.summary.pendingCount) },
      ]
    : []

  return (
    <AdminFrame>
      <p className="text-sm text-amber-300">Bản demo: giao dịch được ghi nhận khi doanh nghiệp đăng ký gói, không thu tiền thật.</p>
      <ErrorNote message={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {cards.map((s) => (
              <div key={s.label} className="rounded-2xl border border-slate-700/70 bg-[#0b1424]/85 p-5">
                <p className="text-xs text-slate-400">{s.label}</p>
                <p className="mt-1 text-2xl font-extrabold text-white">{s.value}</p>
              </div>
            ))}
          </div>

          <Panel title="Lịch sử giao dịch">
            <p className="mb-3 text-xs text-slate-400">
              Nút <strong className="text-slate-200">Gửi lại</strong> gửi lại đúng yêu cầu cũ với cùng mã idempotency, mô phỏng người dùng bấm 2 lần hoặc cổng thanh toán gửi xác nhận lặp lại. Hệ thống phải trả kết quả cũ và không tạo giao dịch mới.
            </p>
            {data.transactions.length === 0 ? (
              <Empty>Chưa có giao dịch.</Empty>
            ) : (
              <div className="overflow-x-auto [scrollbar-color:#334155_transparent] [scrollbar-width:thin]">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="border-b border-slate-700/70 text-xs text-slate-400">
                    <tr>
                      <th className="pb-2 font-semibold">Thời gian</th>
                      <th className="pb-2 font-semibold">Doanh nghiệp</th>
                      <th className="pb-2 font-semibold">Gói</th>
                      <th className="pb-2 font-semibold">Loại</th>
                      <th className="pb-2 font-semibold">Số tiền</th>
                      <th className="pb-2 font-semibold">Mã idempotency</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.transactions.map((t) => (
                      <tr key={t.id} className="border-b border-slate-800 align-top last:border-0">
                        <td className="py-2.5 text-xs text-slate-400">{fmtDateTime(t.createdAt)}</td>
                        <td className="py-2.5 text-slate-200">{t.organization.name}</td>
                        <td className="py-2.5"><Badge tone="blue">{PLAN_NAME[t.planCode] ?? t.planCode}</Badge></td>
                        <td className="py-2.5 text-xs text-slate-300">{t.kind === "PER_CONTRACT" ? "Phí khởi tạo hợp đồng" : "Đăng ký gói"}</td>
                        <td className="py-2.5 text-slate-200">{vnd(t.amountVnd)}</td>
                        <td className="py-2.5 font-mono text-[11px] text-slate-400">{t.idempotencyKey}</td>
                        <td className="py-2.5 text-right">
                          <Btn variant="ghost" onClick={() => doReplay(t)} loading={busy === t.id}>Gửi lại</Btn>
                          {replay?.id === t.id && <p className={`mt-1 max-w-xs text-left text-xs ${replay.ok ? "text-emerald-300" : "text-rose-300"}`}>{replay.message}</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </AdminFrame>
  )
}

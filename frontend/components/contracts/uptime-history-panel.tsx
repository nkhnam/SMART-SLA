"use client"

import { useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { api } from "@/lib/api"
import { Badge, Panel, fmtDateTime } from "@/components/sla/ui"

type Period = { label: string; uptime: number | null; samples: number; belowThreshold: boolean }
type History = {
  hasUptime: boolean
  threshold: number
  unit: string
  periods: Period[]
  alert: { at: string; periods: { label: string; uptime: number }[] } | null
}

// Uptime từng tháng đã kết thúc + cảnh báo điều khoản chấm dứt (Uptime < 95% trong 2 tháng liên tiếp)
export default function UptimeHistoryPanel({ contractId }: { contractId: string }) {
  const [data, setData] = useState<History | null>(null)

  useEffect(() => {
    api<History>(`/api/contracts/${contractId}/uptime-history`).then(setData).catch(() => setData(null))
  }, [contractId])

  if (!data?.hasUptime) return null

  return (
    <Panel title={`Uptime theo ${data.unit}`}>
      {data.alert && (
        <div className="mb-4 flex gap-3 rounded-xl border border-rose-500/50 bg-rose-500/10 p-4 text-sm text-rose-100" role="alert">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" />
          <div>
            <p className="font-bold">Đủ điều kiện chấm dứt hợp đồng</p>
            <p className="mt-1 leading-6">
              Uptime dưới {data.threshold}% trong 2 {data.unit} liên tiếp ({data.alert.periods.map((p) => `${p.label}: ${p.uptime}%`).join(", ")}).
              Theo điều khoản chấm dứt (nếu có trong hợp đồng), Bên mua có quyền đơn phương chấm dứt ngay và được hoàn phần phí chưa sử dụng.
            </p>
            <p className="mt-1 text-xs text-rose-200/80">Cảnh báo gửi lúc {fmtDateTime(data.alert.at)} tới cả hai bên.</p>
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {data.periods.map((p) => (
          <div key={p.label} className={`rounded-xl border p-4 ${p.belowThreshold ? "border-rose-500/50 bg-rose-500/[.06]" : "border-slate-700/80"}`}>
            <p className="text-xs text-slate-400">{p.label}</p>
            <p className="mt-1 text-2xl font-extrabold text-white">{p.uptime === null ? "—" : `${p.uptime}%`}</p>
            <p className="mt-1 text-xs text-slate-500">{p.uptime === null ? "Chưa đủ dữ liệu đo cả kỳ" : `${p.samples} mẫu đo`}</p>
            {p.belowThreshold && <div className="mt-2"><Badge tone="red">Dưới {data.threshold}%</Badge></div>}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">Hệ thống tự kiểm tra mỗi ngày. Uptime dưới {data.threshold}% trong 2 {data.unit} liên tiếp sẽ tự gửi cảnh báo cho cả hai bên.</p>
    </Panel>
  )
}

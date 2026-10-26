"use client"

import { useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"
import AdminFrame from "@/components/admin/admin-frame"
import { api } from "@/lib/api"
import { useSession } from "@/lib/session"
import { Badge, Empty, ErrorNote, Loading, fmtDateTime, inputCls } from "@/components/sla/ui"

type AdminUser = {
  id: string
  fullName: string
  email: string
  role: string
  isActive: boolean
  createdAt: string
  organization: { id: string; name: string; orgType: "BUYER" | "SUPPLIER"; createdAt: string }
  platformAdmin?: boolean
  plan: { code: string; name: string; planCode: string | null; startedAt: string | null; expiresAt: string | null; daysLeft: number | null }
  paymentStatus: string
}

// Nhãn dùng chung. Các gói trả phí để sẵn cho phần thanh toán (đang tạm hoãn).
const PLANS: Record<string, { label: string; tone: "blue" | "green" | "amber" | "slate" | "violet" | "red" }> = {
  NONE: { label: "Chưa đăng ký gói", tone: "slate" },
  PILOT: { label: "Pilot", tone: "blue" },
  PAYG: { label: "Pay as you go", tone: "amber" },
  STARTER: { label: "Starter", tone: "green" },
  ENTERPRISE: { label: "Enterprise", tone: "violet" },
  EXPIRED: { label: "Hết hạn", tone: "red" },
  PLATFORM: { label: "Nội bộ Shadow Byte", tone: "violet" },
}
const ACCOUNT_TYPES: Record<string, string> = { BUYER: "Bên mua", SUPPLIER: "Nhà cung cấp" }
const PAYMENT: Record<string, { label: string; tone: "slate" | "green" | "amber" | "red" }> = {
  NONE: { label: "Chưa thanh toán", tone: "slate" },
  FREE: { label: "Miễn phí (Pilot)", tone: "slate" },
  PAID: { label: "Đã thanh toán (demo)", tone: "green" },
  OVERDUE: { label: "Hết hạn, chưa gia hạn", tone: "red" },
  EXEMPT: { label: "Nội bộ, miễn phí", tone: "slate" },
}
const ROLE: Record<string, string> = { ADMIN: "Quản trị", OPERATIONS: "Vận hành", LEGAL: "Pháp chế", PM: "Quản lý dự án" }

function FilterGroup({ title, options, value, onChange, counts }: {
  title: string
  options: Record<string, string>
  value: string
  onChange: (v: string) => void
  counts: Record<string, number>
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="mb-2 text-xs font-bold text-slate-400">{title}</legend>
      {[["ALL", "Tất cả"], ...Object.entries(options)].map(([code, label]) => (
        <label key={code} className={`flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-sm ${value === code ? "bg-blue-500/15 text-white" : "text-slate-300 hover:bg-slate-800/60"}`}>
          <span className="flex items-center gap-2">
            <input type="radio" name={title} checked={value === code} onChange={() => onChange(code)} className="h-3.5 w-3.5 accent-blue-500" />
            {label}
          </span>
          <span className="text-xs text-slate-500">{code === "ALL" ? counts.ALL : counts[code] ?? 0}</span>
        </label>
      ))}
    </fieldset>
  )
}

export default function AdminPlansPage() {
  const { user } = useSession()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [plan, setPlan] = useState("ALL")
  const [type, setType] = useState("ALL")
  const [payment, setPayment] = useState("ALL")

  useEffect(() => {
    if (!user?.platformAdmin) return
    api<AdminUser[]>("/api/admin/users").then(setUsers).catch((e) => setError(e.message))
  }, [user])

  const count = (key: (u: AdminUser) => string) => {
    const out: Record<string, number> = { ALL: users?.length ?? 0 }
    for (const u of users ?? []) out[key(u)] = (out[key(u)] ?? 0) + 1
    return out
  }

  const list = useMemo(() => {
    const term = q.trim()
    return (users ?? []).filter(
      (u) =>
        // Tìm theo tên người dùng, PHÂN BIỆT chữ hoa / chữ thường
        (!term || u.fullName.includes(term)) &&
        (plan === "ALL" || u.plan.code === plan) &&
        (type === "ALL" || u.organization.orgType === type) &&
        (payment === "ALL" || u.paymentStatus === payment),
    )
  }, [users, q, plan, type, payment])

  return (
    <AdminFrame>
      <ErrorNote message={error} />
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="h-fit space-y-5 rounded-2xl border border-slate-700/70 bg-[#0b1424]/85 p-4" aria-label="Bộ lọc">
          <FilterGroup title="Gói dịch vụ" options={Object.fromEntries(Object.entries(PLANS).map(([k, v]) => [k, v.label]))} value={plan} onChange={setPlan} counts={count((u) => u.plan.code)} />
          <FilterGroup title="Loại tài khoản" options={ACCOUNT_TYPES} value={type} onChange={setType} counts={count((u) => u.organization.orgType)} />
          <FilterGroup title="Trạng thái thanh toán" options={Object.fromEntries(Object.entries(PAYMENT).map(([k, v]) => [k, v.label]))} value={payment} onChange={setPayment} counts={count((u) => u.paymentStatus)} />
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-400">{users ? `${list.length} / ${users.length} người dùng` : ""}</p>
            <div className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-500" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên (phân biệt hoa thường)" className={`${inputCls} pl-9`} aria-label="Tìm theo tên người dùng" />
            </div>
          </div>

          {!users && !error && <Loading />}
          {users && list.length === 0 && <Empty>Không có người dùng phù hợp.</Empty>}
          {list.length > 0 && (
            <div className="overflow-x-auto rounded-2xl border border-slate-700/70 bg-[#0b1424]/85 [scrollbar-color:#334155_transparent] [scrollbar-width:thin]">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="border-b border-slate-700/70 text-xs text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Người dùng</th>
                    <th className="px-4 py-3 font-semibold">Doanh nghiệp</th>
                    <th className="px-4 py-3 font-semibold">Loại tài khoản</th>
                    <th className="px-4 py-3 font-semibold">Vai trò</th>
                    <th className="px-4 py-3 font-semibold">Gói</th>
                    <th className="px-4 py-3 font-semibold">Hạn gói</th>
                    <th className="px-4 py-3 font-semibold">Thanh toán</th>
                    <th className="px-4 py-3 font-semibold">Ngày tạo</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((u) => (
                    <tr key={u.id} className="border-b border-slate-800 last:border-0 hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-white">
                          {u.fullName}
                          {u.platformAdmin && <span className="ml-2"><Badge tone="violet">Admin nền tảng</Badge></span>}
                          {!u.isActive && <span className="ml-2 text-xs text-rose-300">(đã khoá)</span>}
                        </p>
                        <p className="text-xs text-slate-400">{u.email}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-200">{u.organization.name}</td>
                      <td className="px-4 py-3 text-slate-300">{ACCOUNT_TYPES[u.organization.orgType]}</td>
                      <td className="px-4 py-3 text-slate-300">{ROLE[u.role] ?? u.role}</td>
                      <td className="px-4 py-3"><Badge tone={PLANS[u.plan.code]?.tone ?? "slate"}>{u.plan.code === "EXPIRED" ? `${u.plan.name} (hết hạn)` : PLANS[u.plan.code]?.label ?? u.plan.code}</Badge></td>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        {u.plan.expiresAt ? fmtDateTime(u.plan.expiresAt) : u.plan.planCode === "PAYG" ? "Theo từng hợp đồng" : "Không áp dụng"}
                        {u.plan.daysLeft !== null && u.plan.daysLeft > 0 && <span className="block text-blue-300">còn {u.plan.daysLeft} ngày</span>}
                      </td>
                      <td className="px-4 py-3"><Badge tone={PAYMENT[u.paymentStatus]?.tone ?? "slate"}>{PAYMENT[u.paymentStatus]?.label ?? u.paymentStatus}</Badge></td>
                      <td className="px-4 py-3 text-xs text-slate-400">{fmtDateTime(u.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AdminFrame>
  )
}

"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Check, Sparkles } from "lucide-react"
import AppShell from "@/components/ui/app-shell"
import { api } from "@/lib/api"
import { useSession } from "@/lib/session"
import { PLAN_EVENT, type PlanDef, useMyPlan } from "@/lib/plan"
import { Badge, Btn, ErrorNote, Loading, Panel, fmtDateTime } from "@/components/sla/ui"

type Tx = { id: string; planCode: string; amountVnd: number; status: string; description: string; idempotencyKey: string; createdAt: string }

const vnd = (n: number) => `${n.toLocaleString("vi-VN")} ₫`
// Mã idempotency cho mỗi lần bấm đăng ký: bấm lại / mạng gửi lại cùng mã -> không tạo giao dịch trùng
const newKey = () => `sub-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`

export default function PricingPage() {
  const { user } = useSession()
  const { plan } = useMyPlan()
  const [plans, setPlans] = useState<PlanDef[] | null>(null)
  const [history, setHistory] = useState<Tx[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  // Giữ cùng 1 mã cho tới khi đăng ký xong -> bấm nhiều lần vẫn chỉ 1 giao dịch
  const [keys, setKeys] = useState<Record<string, string>>({})

  useEffect(() => {
    api<PlanDef[]>("/api/billing/plans").then(setPlans).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!user) return
    api<Tx[]>("/api/billing/history").then(setHistory).catch(() => setHistory([]))
  }, [user, plan?.code, plan?.expiresAt])

  const subscribe = async (p: PlanDef) => {
    const key = keys[p.code] ?? newKey()
    setKeys((k) => ({ ...k, [p.code]: key }))
    setBusy(p.code)
    setError(null)
    setInfo(null)
    try {
      const r = await api<{ replayed: boolean }>("/api/billing/subscribe", { method: "POST", body: { planCode: p.code, idempotencyKey: key } })
      setInfo(r.replayed ? `Yêu cầu đã được xử lý trước đó, không tạo giao dịch mới.` : `Đã kích hoạt gói ${p.name}.`)
      setKeys((k) => ({ ...k, [p.code]: newKey() })) // lần đăng ký sau dùng mã mới
      window.dispatchEvent(new Event(PLAN_EVENT))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đăng ký được gói")
    } finally {
      setBusy(null)
    }
  }

  const buttonFor = (p: PlanDef) => {
    if (!user) {
      return <Link href="/register" className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white hover:bg-blue-500">Đăng ký tài khoản</Link>
    }
    if (plan?.status === "PLATFORM") return <Btn variant="ghost" className="w-full" disabled>Tài khoản nội bộ</Btn>
    const current = plan?.code === p.code && plan.active
    if (p.code === "PILOT" && plan?.pilotUsed) return <Btn variant="ghost" className="w-full" disabled>{current ? "Đang dùng" : "Đã dùng Pilot"}</Btn>
    if (current && p.code === "PAYG") return <Btn variant="ghost" className="w-full" disabled>Đang dùng</Btn>
    return (
      <Btn className="w-full" onClick={() => subscribe(p)} loading={busy === p.code} disabled={!!busy}>
        {current ? "Gia hạn thêm 30 ngày" : p.code === "PILOT" ? "Dùng thử miễn phí" : "Đăng ký gói"}
      </Btn>
    )
  }

  return (
    <AppShell allowGuest>
      <main className="mx-auto w-full max-w-7xl space-y-8 px-4 py-10 sm:px-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Gói dịch vụ</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Gói tính theo doanh nghiệp, áp dụng cho cả bên mua và nhà cung cấp. Chưa đăng ký gói thì chỉ xem được giao diện.
            <span className="text-amber-300"> Bản demo: bấm đăng ký là kích hoạt ngay, không thu tiền thật.</span>
          </p>
        </div>

        {user && plan && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-700/70 bg-[#0b1424]/85 px-5 py-4 text-sm">
            <span className="text-slate-400">Gói hiện tại:</span>
            <Badge tone={plan.active ? "green" : plan.status === "EXPIRED" ? "red" : "slate"}>{plan.status === "EXPIRED" ? `${plan.name} (hết hạn)` : plan.name}</Badge>
            {plan.expiresAt && <span className="text-slate-300">{plan.active ? "hết hạn" : "đã hết hạn"} {fmtDateTime(plan.expiresAt)}</span>}
            {plan.active && plan.status !== "PLATFORM" && (
              <span className="text-slate-400">· SLA đang dùng {plan.liveSla}{plan.limits.maxActiveSla !== null ? `/${plan.limits.maxActiveSla}` : ""}</span>
            )}
          </div>
        )}

        <ErrorNote message={error} />
        {info && <p className="text-sm text-emerald-300" role="status">{info}</p>}
        {!plans && !error && <Loading />}

        {plans && (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {plans.map((p) => {
              const current = plan?.code === p.code && plan.active
              const highlight = p.code === "STARTER"
              return (
                <section
                  key={p.code}
                  className={`flex flex-col rounded-2xl border p-6 ${current ? "border-emerald-500/60 bg-emerald-500/[.05]" : highlight ? "border-blue-500/60 bg-blue-500/[.05]" : "border-slate-700/70 bg-[#0b1424]/85"}`}
                  aria-label={`Gói ${p.name}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-xl font-extrabold text-white">{p.name}</h2>
                    {current ? <Badge tone="green">Đang dùng</Badge> : highlight ? <Badge tone="blue"><Sparkles className="h-3 w-3" />Phổ biến</Badge> : null}
                  </div>
                  <p className="mt-3 min-h-[72px] text-sm leading-6 text-slate-400">{p.tagline}</p>
                  <div className="mt-4">
                    <p className="text-3xl font-extrabold text-white">{p.priceLabel}</p>
                    <p className="text-xs text-slate-400">{p.priceNote}</p>
                  </div>
                  <div className="mt-5">{buttonFor(p)}</div>
                  <ul className="mt-6 space-y-2.5 border-t border-slate-800 pt-5 text-sm text-slate-300">
                    {p.features.map((f) => (
                      <li key={f} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /><span>{f}</span></li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        )}

        {user && history.length > 0 && (
          <Panel title="Lịch sử đăng ký và phí">
            <div className="overflow-x-auto [scrollbar-color:#52525b_transparent] [scrollbar-width:thin]">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs text-slate-400">
                  <tr><th className="pb-2 font-semibold">Thời gian</th><th className="pb-2 font-semibold">Nội dung</th><th className="pb-2 font-semibold">Số tiền</th><th className="pb-2 font-semibold">Trạng thái</th></tr>
                </thead>
                <tbody>
                  {history.map((t) => (
                    <tr key={t.id} className="border-t border-slate-800">
                      <td className="py-2 text-xs text-slate-400">{fmtDateTime(t.createdAt)}</td>
                      <td className="py-2 text-slate-200">{t.description}</td>
                      <td className="py-2 text-slate-200">{vnd(t.amountVnd)}</td>
                      <td className="py-2"><Badge tone="green">Demo, đã ghi nhận</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </main>
    </AppShell>
  )
}

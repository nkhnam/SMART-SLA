"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ArrowRight, BarChart3, BriefcaseBusiness, FileCheck2 } from "lucide-react"
import AppShell from "@/components/ui/app-shell"
import { AiscBadge } from "@/components/ui/brand-logo"
import MarketingSections, { MarketingHero } from "@/components/home/marketing"
import { api } from "@/lib/api"
import { useSession } from "@/lib/session"
import type { Contract, Violation } from "@/lib/types"

const homeCards = [
  { href: "/dashboard", eyebrow: "Giám sát", title: "Dashboard", description: "Theo dõi hợp đồng, KPI đo thật và các vụ vi phạm đang mở.", icon: BarChart3, tone: "cyan" },
  { href: "/marketplace", eyebrow: "Nhà cung cấp", title: "Marketplace", description: "Chọn đối tác dựa trên hiệu suất đã được xác minh.", icon: BriefcaseBusiness, tone: "emerald" },
  { href: "/contracts", eyebrow: "Hợp đồng SLA", title: "Hợp đồng của tôi", description: "Ký hợp đồng chờ ký, xem điều khoản và kiểm chứng trên Polygon.", icon: FileCheck2, tone: "rose" },
] as const

const TONE = {
  cyan: { card: "border-slate-700/80", pill: "text-cyan-300 border-cyan-500/40 bg-cyan-500/10", icon: "text-cyan-200" },
  emerald: { card: "border-slate-700/80", pill: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10", icon: "text-emerald-200" },
  rose: { card: "border-slate-700/80", pill: "text-rose-300 border-rose-500/50 bg-rose-500/10", icon: "text-rose-200" },
} as const

export default function HomePage() {
  const { user } = useSession()
  const [stats, setStats] = useState<{ contracts: number; toSign: number; openViolations: number } | null>(null)

  useEffect(() => {
    if (!user) return // khách chưa đăng nhập: chỉ xem giao diện, không gọi dữ liệu
    Promise.all([api<Contract[]>("/api/contracts/list"), api<Violation[]>("/api/violations")])
      .then(([contracts, violations]) =>
        setStats({
          contracts: contracts.length,
          toSign: contracts.filter((c) => c.status === "PENDING_SIGNATURE").length,
          openViolations: violations.filter((v) => v.status === "PENDING" || v.status === "CHALLENGED").length,
        }),
      )
      .catch(() => setStats(null))
  }, [user])

  const statItems = [
    { label: "Hợp đồng", value: stats?.contracts, cls: "text-cyan-200" },
    { label: "Chờ ký", value: stats?.toSign, cls: "text-violet-200" },
    { label: "Vi phạm đang mở", value: stats?.openViolations, cls: "text-amber-200" },
  ]

  return (
    <AppShell allowGuest>
      <main className="relative mx-auto w-full max-w-[1600px] px-4 pb-16 pt-10 sm:px-6 lg:px-10">

        {!user && <MarketingHero />}
        {user && (
        <section className="relative z-10">
          <div className="mb-12 text-center">
            <AiscBadge width={190} className="mb-7" />
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-400">Trung tâm điều hướng</p>
            <h1 className="mt-3 font-[family-name:var(--font-display)] text-[clamp(40px,6vw,84px)] font-extrabold leading-[1.05] tracking-[-0.03em] text-white">
              Xin chào, {user?.fullName ?? "Khách tham quan"}
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-sm font-semibold leading-6 text-slate-300">Chọn khu vực bạn muốn truy cập trong hệ thống SMART-SLA.</p>
            <div className="mx-auto mt-7 grid max-w-3xl grid-cols-1 divide-y divide-slate-700/50 rounded-2xl border border-slate-500/20 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {statItems.map((s) => (
                <div key={s.label} className="px-5 py-3 text-left">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{s.label}</span>
                  <strong className={`mt-1 block font-mono text-lg font-medium ${s.cls}`}>{s.value ?? "—"}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {homeCards.map((card) => {
              const Icon = card.icon
              const t = TONE[card.tone]
              return (
                <Link key={card.href} href={card.href} className={`group flex min-h-72 flex-col items-center rounded-3xl border p-7 text-center transition duration-300 hover:-translate-y-1 hover:shadow-2xl ${t.card}`}>
                  <span className={`self-start rounded-full border px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] ${t.pill}`}>{card.eyebrow}</span>
                  <span className="mt-6 grid h-14 w-14 place-items-center rounded-2xl border border-slate-500/30 bg-slate-900/60">
                    <Icon className={`h-7 w-7 ${t.icon}`} />
                  </span>
                  <h2 className="mt-5 font-[family-name:var(--font-display)] text-[26px] font-bold leading-tight text-white lg:text-[34px]">{card.title}</h2>
                  <p className="mb-6 mt-3 max-w-sm text-sm font-semibold leading-6 text-slate-300">{card.description}</p>
                  <span className="mt-auto translate-y-0 pt-0 inline-flex items-center gap-2 rounded-xl border border-blue-400/50 bg-blue-600/40 px-4 py-2 text-sm font-semibold text-white transition group-hover:bg-blue-500/60">
                    Truy cập <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                  </span>
                </Link>
              )
            })}
          </div>
        </section>
        )}
        <MarketingSections loggedIn={!!user} />
      </main>
    </AppShell>
  )
}

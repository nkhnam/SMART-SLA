"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Blocks, CreditCard, Store, Users } from "lucide-react"
import AppShell from "@/components/ui/app-shell"
import { useSession } from "@/lib/session"
import { Empty } from "@/components/sla/ui"

const TABS = [
  { href: "/admin", label: "Blockchain", icon: Blocks },
  { href: "/admin/listings", label: "Duyệt dịch vụ", icon: Store },
  { href: "/admin/plans", label: "Gói dịch vụ", icon: Users },
  { href: "/admin/revenue", label: "Doanh thu", icon: CreditCard },
]

// Khung chung cho 3 màn hình Admin: tiêu đề + tab + chặn người không phải admin nền tảng
export default function AdminFrame({ children }: { children: React.ReactNode }) {
  const { user } = useSession()
  const pathname = usePathname()

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-10 sm:px-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-white">Admin nền tảng</h1>
        {user && !user.platformAdmin ? (
          <Empty>Trang này chỉ dành cho admin nền tảng SMART-SLA.</Empty>
        ) : (
          <>
            <nav className="flex flex-wrap gap-2 border-b border-slate-800 pb-3" aria-label="Màn hình quản trị">
              {TABS.map((t) => {
                const active = pathname === t.href
                const Icon = t.icon
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${active ? "bg-blue-500/15 text-white" : "text-slate-400 hover:text-white"}`}
                  >
                    <Icon className="h-4 w-4" /> {t.label}
                  </Link>
                )
              })}
            </nav>
            {children}
          </>
        )}
      </main>
    </AppShell>
  )
}

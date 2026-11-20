"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Bell, ChevronDown, LogIn, LogOut, Menu, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { api } from "@/lib/api"
import { useSession } from "@/lib/session"
import { useMyPlan } from "@/lib/plan"
import type { Notification } from "@/lib/types"
import { fmtDateTime } from "@/components/sla/ui"
import { AiscMark } from "@/components/ui/brand-logo"
import SiteFooter from "@/components/ui/site-footer"

// allowGuest: trang cho phép khách chưa đăng nhập xem (trang chủ). Các trang khác hiện lời mời đăng nhập.
type AppShellProps = { children: React.ReactNode; allowGuest?: boolean }

const ROLE_LABEL = { ADMIN: "Quản trị", OPERATIONS: "Vận hành", LEGAL: "Pháp chế", PM: "Quản lý dự án" } as const

export default function AppShell({ children, allowGuest = false }: AppShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, ready, logout } = useSession()
  const [profileOpen, setProfileOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const { plan } = useMyPlan()

  const loadNotifications = useCallback(async () => {
    try {
      setNotifications(await api<Notification[]>("/api/notifications", { timeoutMs: 30_000 }))
    } catch {
      /* thông báo không quan trọng bằng nội dung trang -> bỏ qua lỗi */
    }
  }, [])

  useEffect(() => {
    if (!user) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadNotifications()
    const t = setInterval(loadNotifications, 60_000)
    return () => clearInterval(t)
  }, [user, loadNotifications])

  const unread = notifications.filter((n) => !n.readAt).length

  const markAllRead = async () => {
    try {
      await api("/api/notifications/read-all", { method: "POST" })
      loadNotifications()
    } catch {
      /* bỏ qua */
    }
  }

  const handleLogout = () => {
    logout()
    router.replace("/")
  }

  if (!ready) {
    return <div className="app-theme min-h-screen" />
  }

  const nav = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/marketplace", label: "Marketplace" },
    { href: "/create-sla", label: "Tạo SLA" },
    { href: "/contracts", label: "Hợp đồng" },
    { href: "/negotiations", label: "Bàn bạc" },
    { href: "/pricing", label: "Gói dịch vụ" },
    ...(user?.platformAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ]
  const currentLabel = nav.find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`))?.label
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)
  const initials = (user?.fullName ?? "").split(/\s+/).filter(Boolean).slice(-2).map((p) => p[0]).join("").toUpperCase() || "SS"

  return (
    <div className="app-theme relative isolate min-h-screen overflow-hidden text-slate-100 print:overflow-visible print:bg-white">
      <header className="sticky top-0 z-40 print:hidden border-b border-black/10 bg-white/70 shadow-[0_8px_30px_rgba(0,0,0,.07)] backdrop-blur-2xl">
        <div className="mx-auto flex h-20 max-w-[1600px] items-center gap-5 px-4 sm:px-6 lg:px-10">
          <Link href="/" className="flex shrink-0 items-center gap-3" aria-label="SMART-SLA trang chủ">
            <AiscMark height={40} />
            <span className="hidden whitespace-nowrap font-[family-name:var(--font-display)] text-lg font-extrabold tracking-[-0.02em] text-white sm:inline lg:hidden xl:inline">SMART-SLA<span className="ml-1 text-cyan-400">•</span></span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label="Điều hướng chính">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${isActive(item.href) ? "bg-blue-500/15 text-white" : "text-slate-400 hover:text-white"}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {!user ? (
              <>
                <Link href="/login" className="inline-flex h-10 items-center justify-center px-3 sm:w-28 sm:px-0 rounded-xl border border-slate-600 bg-slate-900/80 text-sm font-semibold text-slate-200 transition hover:border-slate-400 hover:text-white">
                  Đăng nhập
                </Link>
                <Link href="/register" className="inline-flex h-10 items-center justify-center px-3 sm:w-28 sm:px-0 rounded-xl bg-blue-600 text-sm font-semibold text-white transition hover:bg-blue-500">
                  Đăng ký
                </Link>
              </>
            ) : (
              <>
            <div className="hidden h-10 items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-900/80 px-3 xl:flex" title="Mạng blockchain đang dùng">
              <span className="h-2.5 w-2.5 rounded-full bg-violet-400 shadow-[0_0_10px_rgba(0,0,0,.45)]" />
              <span className="font-mono text-xs font-medium text-slate-300">Polygon Amoy</span>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setBellOpen((v) => !v)}
                className="relative grid h-10 w-10 place-items-center rounded-xl border border-slate-700/80 bg-slate-900/80 text-slate-300 transition hover:border-slate-600 hover:text-white"
                aria-label={`Thông báo${unread ? ` (${unread} chưa đọc)` : ""}`}
                aria-expanded={bellOpen}
              >
                <Bell className="h-4.5 w-4.5" />
                {unread > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-slate-900" />}
              </button>
              {bellOpen && (
                <div className="absolute right-0 mt-2 w-[22rem] max-w-[90vw] rounded-xl border border-slate-700 bg-[#0e1728] shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-700/70 px-4 py-3">
                    <span className="text-sm font-bold text-white">Thông báo</span>
                    {unread > 0 && (
                      <button type="button" onClick={markAllRead} className="text-xs font-semibold text-blue-300 hover:text-blue-200">
                        Đánh dấu đã đọc
                      </button>
                    )}
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="px-4 py-6 text-center text-xs text-slate-400">Chưa có thông báo.</p>
                    ) : (
                      notifications.map((n) => (
                        <Link
                          key={n.id}
                          href={n.contractId ? `/contracts/${n.contractId}` : n.type.startsWith("LISTING_") ? "/marketplace?tab=manage" : "/dashboard"}
                          onClick={() => setBellOpen(false)}
                          className={`block border-b border-slate-800 px-4 py-3 hover:bg-slate-800/60 ${n.readAt ? "opacity-70" : ""}`}
                        >
                          <p className="text-sm font-semibold text-slate-100">{n.title}</p>
                          <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-400">{n.message}</p>
                          <p className="mt-1 text-[11px] text-slate-500">{fmtDateTime(n.createdAt)}</p>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setProfileOpen((v) => !v)}
                className="flex h-10 items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-900/80 px-2.5 text-sm font-semibold text-white transition hover:border-slate-600"
                aria-expanded={profileOpen}
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-blue-600 text-[11px] font-extrabold">{initials}</span>
                <span className="hidden max-w-36 truncate sm:block">{user.organization.name}</span>
                <ChevronDown className="h-4 w-4 text-slate-500" />
              </button>
              {profileOpen && (
                <div className="absolute right-0 mt-2 w-60 rounded-xl border border-slate-700 bg-[#0e1728] p-1.5 shadow-2xl">
                  <div className="px-3 py-2">
                    <p className="truncate text-sm font-semibold text-white">{user.fullName}</p>
                    {user.jobTitle && <p className="truncate text-xs text-slate-300">{user.jobTitle}</p>}
                    <p className="truncate text-xs text-slate-400">{user.email}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {user.organization.orgType === "SUPPLIER" ? "Nhà cung cấp" : "Bên mua"} · {ROLE_LABEL[user.role]}
                    </p>
                  </div>
                  <Link href="/pricing" onClick={() => setProfileOpen(false)} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
                    <span>Gói dịch vụ</span>
                    <span className={`text-xs ${plan?.active ? "text-emerald-300" : "text-amber-300"}`}>{plan ? (plan.status === "EXPIRED" ? "Hết hạn" : plan.name) : ""}</span>
                  </Link>
                  <Link href="/settings#tai-khoan" onClick={() => setProfileOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">Thông tin tài khoản</Link>
                  <Link href="/settings" onClick={() => setProfileOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">Cài đặt doanh nghiệp</Link>
                  <button type="button" onClick={handleLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-rose-300 hover:bg-rose-500/10">
                    <LogOut className="h-4 w-4" /> Đăng xuất
                  </button>
                </div>
              )}
            </div>

              </>
            )}

            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="grid h-10 w-10 place-items-center rounded-xl border border-slate-700/80 bg-slate-900/80 text-slate-300 lg:hidden"
              aria-label="Mở menu"
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="border-t border-slate-800 px-4 py-3 lg:hidden" aria-label="Điều hướng (di động)">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className={`block rounded-lg px-3 py-2 text-sm font-semibold ${isActive(item.href) ? "bg-blue-500/15 text-white" : "text-slate-300"}`}>
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      {user && plan && !plan.active && pathname !== "/pricing" && (
        // Chưa có gói / hết hạn: vẫn xem được giao diện, tính năng bị khoá ở phía máy chủ
        <div className="relative z-30 print:hidden border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-center text-sm text-amber-100" role="status">
          {plan.status === "EXPIRED" ? `Gói ${plan.name} đã hết hạn.` : "Doanh nghiệp chưa đăng ký gói dịch vụ."} Bạn đang ở chế độ xem, chưa dùng được các tính năng.{" "}
          <Link href="/pricing" className="font-bold text-amber-300 underline underline-offset-2 hover:text-amber-200">Chọn gói (có Pilot miễn phí)</Link>
        </div>
      )}

      <div className="app-grid relative z-10 min-h-[calc(100vh-5rem)]">
        {user || allowGuest ? (
          children
        ) : (
          // Khách xem được khung giao diện, nhưng tính năng chỉ dùng được sau khi đăng nhập (không gọi dữ liệu)
          <main className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-xl flex-col items-center justify-center px-4 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-600/20 text-blue-300">
              <LogIn className="h-6 w-6" />
            </div>
            <h1 className="mt-5 text-2xl font-extrabold text-white">Đăng nhập để dùng {currentLabel ?? "tính năng này"}</h1>
            <p className="mt-2 text-sm text-slate-400">Tạo tài khoản doanh nghiệp hoặc đăng nhập để tiếp tục.</p>
            <div className="mt-6 flex gap-3">
              <Link href="/login" className="inline-flex h-10 w-32 items-center justify-center rounded-xl border border-slate-600 bg-slate-900/80 text-sm font-bold text-slate-200 hover:border-slate-400">Đăng nhập</Link>
              <Link href="/register" className="inline-flex h-10 w-32 items-center justify-center rounded-xl bg-blue-600 text-sm font-bold text-white hover:bg-blue-500">Đăng ký</Link>
            </div>
          </main>
        )}
      </div>

      <SiteFooter />
    </div>
  )
}

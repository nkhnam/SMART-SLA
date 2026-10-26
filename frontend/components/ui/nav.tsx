"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"

export default function Nav() {
  const path = usePathname() || "/"
  const items = [
    { href: "/", label: "Dashboard" },
    { href: "/create-sla", label: "Tạo SLA" },
    { href: "/marketplace", label: "Marketplace" },
    { href: "/settings", label: "Cài đặt" },
    { href: "/pricing", label: "Bảng giá" },
  ]

  return (
    <nav className="w-full border-b bg-card/50">
      <div className="max-w-6xl mx-auto flex items-center gap-6 px-4 py-3">
        <div className="font-semibold">SLA-DEX</div>
        <div className="flex gap-2 ml-4">
          {items.map(i => {
            const active = path === i.href
            return (
              <Link
                key={i.href}
                href={i.href}
                className={
                  "px-3 py-1 rounded text-sm " + (active ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:text-foreground")
                }
              >
                {i.label}
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
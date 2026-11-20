import Link from "next/link"
import Image from "next/image"
import { Activity, FileSignature, ShieldCheck } from "lucide-react"
import { AiscMark } from "@/components/ui/brand-logo"

const footerNav = [
  { href: "/dashboard", label: "Dashboard quản trị" },
  { href: "/marketplace", label: "Marketplace SLA" },
  { href: "/contracts", label: "Hợp đồng của tôi" },
  { href: "/create-sla", label: "Tạo hợp đồng SLA" },
  { href: "/negotiations", label: "Bàn bạc điều khoản" },
  { href: "/pricing", label: "Gói dịch vụ" },
]

// Footer dùng chung cho mọi trang: full chiều ngang, nền đen obsidian kính mờ
export default function SiteFooter() {
  return (
  <footer className="brand-footer relative z-10 w-full font-sans font-semibold print:hidden">
    <div className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6 lg:px-10">
        <div className="grid gap-10 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <div className="flex items-center gap-3">
              <AiscMark height={40} />
              <div>
                <p className="font-[family-name:var(--font-display)] text-lg font-extrabold leading-none text-white">SMART-SLA<span className="ml-1 text-cyan-400">•</span></p>
                <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Trust protocol</p>
              </div>
            </div>
            <p className="mt-4 max-w-sm text-sm leading-6 text-slate-300">
              Hạ tầng quản trị SLA giúp hai doanh nghiệp thống nhất KPI, theo dõi bằng chứng và ký kết minh bạch.
            </p>
            <Image src="/brand/aisc26-white.png" alt="AISC'26" width={1200} height={485} className="mt-5 h-auto w-36 opacity-90" />
          </div>

          <div>
            <h3 className="font-sans text-xs font-semibold uppercase tracking-[0.18em] text-white">Điều hướng hệ thống</h3>
            <ul className="mt-4 space-y-2.5 text-sm text-slate-300">
              {footerNav.map((n) => (
                <li key={n.href}><Link href={n.href} className="hover:text-white">{n.label}</Link></li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-sans text-xs font-semibold uppercase tracking-[0.18em] text-white">Nền tảng tin cậy</h3>
            <ul className="mt-4 space-y-3 text-sm text-slate-300">
              <li className="flex gap-2"><Activity className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />Giám sát KPI và cảnh báo theo thời gian thực</li>
              <li className="flex gap-2"><FileSignature className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />Lưu vết thỏa thuận qua từng phiên bản hợp đồng</li>
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />Hai bên kiểm tra trước khi chốt kết quả</li>
            </ul>
          </div>

          <div>
            <h3 className="font-sans text-xs font-semibold uppercase tracking-[0.18em] text-white">Trust stack</h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              {["Bằng chứng trên Polygon", "Đối soát KPI qua Oracle", "Chữ ký số EIP-712 / OTP"].map((t) => (
                <li key={t} className="flex items-center gap-2 rounded-xl border border-slate-500/30 bg-slate-900/50 px-4 py-2.5 font-medium text-slate-100">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />{t}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-wrap justify-between gap-2 border-t border-slate-700/60 pt-5 text-xs text-slate-400">
          <span>© 2026 SMART-SLA · AISC&apos;26</span>
          <span>Polygon Amoy testnet · Bản demo, thanh toán giả lập</span>
        </div>
      </div>
    </footer>
  )
}

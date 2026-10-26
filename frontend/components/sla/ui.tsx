"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"

// Định dạng
export const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false }) : "—"
export const fmtPercent = (bps: number) => `${(bps / 100).toLocaleString("vi-VN")}%`
export const shortHash = (h?: string | null) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : "—")
export const PARTY_LABEL = { BUYER: "Bên mua", SUPPLIER: "Nhà cung cấp" } as const

// Trạng thái
type Tone = "slate" | "blue" | "green" | "amber" | "red" | "violet"
const TONE: Record<Tone, string> = {
  slate: "border-slate-600/60 bg-slate-500/10 text-slate-300",
  blue: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  green: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  red: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  violet: "border-violet-500/40 bg-violet-500/10 text-violet-300",
}

export const CONTRACT_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING_SIGNATURE: { label: "Chờ ký", tone: "violet" },
  ACTIVE: { label: "Đang hiệu lực", tone: "green" },
  WARNING: { label: "Cảnh báo", tone: "amber" },
  VIOLATED: { label: "Đang vi phạm", tone: "red" },
  TERMINATED: { label: "Đã dừng (chạm trần phạt)", tone: "red" },
}

export const VIOLATION_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "Đang chờ phản đối", tone: "amber" },
  CHALLENGED: { label: "Bị phản đối", tone: "violet" },
  SETTLED: { label: "Đã chốt", tone: "red" },
  UPHELD: { label: "Giữ nguyên vi phạm", tone: "red" },
  DISMISSED: { label: "Đã huỷ vi phạm", tone: "slate" },
}

export function Badge({ tone = "slate", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${TONE[tone]}`}>
      {children}
    </span>
  )
}

export function StatusBadge({ status, kind = "contract" }: { status: string; kind?: "contract" | "violation" }) {
  const s = (kind === "contract" ? CONTRACT_STATUS : VIOLATION_STATUS)[status] ?? { label: status, tone: "slate" as Tone }
  return <Badge tone={s.tone}>{s.label}</Badge>
}

// Khối giao diện
export function Panel({ title, action, children, className = "" }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-700/70 bg-[#0b1424]/85 p-5 backdrop-blur ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-base font-bold text-white">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export const inputCls =
  "h-10 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 text-sm text-slate-100 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-slate-300">
      {label}
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-[11px] font-normal text-slate-500">{hint}</span>}
    </label>
  )
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger"; loading?: boolean }
export function Btn({ variant = "primary", loading, children, className = "", disabled, ...rest }: BtnProps) {
  const styles =
    variant === "primary"
      ? "bg-blue-600 text-white hover:bg-blue-500"
      : variant === "danger"
        ? "border border-rose-500/50 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
        : "border border-slate-600 bg-slate-900/70 text-slate-200 hover:border-slate-500"
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}

export function ErrorNote({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

export function Loading({ text = "Đang tải dữ liệu…" }: { text?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" /> {text}
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-400">{children}</div>
}

// Đồng hồ đếm ngược tới hạn chót
export function Countdown({ deadline }: { deadline: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const ms = new Date(deadline).getTime() - now
  if (ms <= 0) return <span className="text-slate-400">Đã hết hạn</span>
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  return <span className="font-mono tabular-nums text-amber-200">{d > 0 ? `${d} ngày ` : ""}{pad(h)}:{pad(m)}:{pad(sec)}</span>
}

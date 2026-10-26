// Giá trị hợp đồng, thời hạn hiệu lực, nhãn mức phạt (khớp backend contract-terms.ts)
import type { CreditTier } from "@/lib/types"

const VN_OFFSET_MS = 7 * 3_600_000

// Thời điểm (ISO) -> 'YYYY-MM-DD' theo giờ Việt Nam
export function vnDate(iso?: string | null): string {
  if (!iso) return ""
  return new Date(new Date(iso).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10)
}

export function todayVn(): string {
  return vnDate(new Date().toISOString())
}

// Mặc định thời hạn 12 tháng: hết hạn ngày trước ngày tròn 1 năm
export function oneYearLater(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const t = new Date(Date.UTC(y + 1, m - 1, d) - 86_400_000)
  return t.toISOString().slice(0, 10)
}

// 'YYYY-MM-DD' -> 'DD/MM/YYYY'
export function fmtYmd(ymd?: string | null): string {
  if (!ymd) return "—"
  const [y, m, d] = ymd.split("-")
  return `${d}/${m}/${y}`
}

export const fmtVnd = (n?: number | null) => (n === null || n === undefined ? "—" : `${Math.round(n).toLocaleString("vi-VN")} ₫`)

// Ô nhập tiền: chỉ giữ chữ số, hiển thị có dấu chấm ngăn cách
export const digitsOnly = (s: string) => s.replace(/\D/g, "").slice(0, 14)
export const groupDigits = (s: string) => (s ? Number(s).toLocaleString("vi-VN") : "")

export type Severity = "Minor" | "Moderate" | "Severe"

// Bậc nhẹ nhất = Minor, nặng nhất = Severe, ở giữa = Moderate
export function severityOf(index: number, count: number): Severity {
  if (count <= 1 || index >= count - 1) return "Severe"
  if (index === 0) return "Minor"
  return "Moderate"
}

export function sortTiers(tiers: CreditTier[]): CreditTier[] {
  return [...(tiers ?? [])].sort((a, b) => (a.maxBreach ?? Infinity) - (b.maxBreach ?? Infinity))
}

export const SEVERITY_CLS: Record<Severity, string> = {
  Minor: "border-amber-400/40 bg-amber-400/10 text-amber-200",
  Moderate: "border-orange-400/40 bg-orange-400/10 text-orange-200",
  Severe: "border-rose-500/50 bg-rose-500/15 text-rose-200",
}

export const TERM_STATE: Record<string, { label: string; cls: string }> = {
  NOT_STARTED: { label: "Chưa tới ngày hiệu lực", cls: "text-amber-300" },
  IN_EFFECT: { label: "Đang hiệu lực", cls: "text-emerald-300" },
  EXPIRED: { label: "Đã hết hạn", cls: "text-rose-300" },
  UNSET: { label: "Chưa khai báo thời hạn", cls: "text-slate-400" },
}

export function termStateOf(from?: string | null, to?: string | null, now = Date.now()): keyof typeof TERM_STATE {
  if (!from && !to) return "UNSET"
  if (from && now < new Date(from).getTime()) return "NOT_STARTED"
  if (to && now >= new Date(to).getTime() + 86_400_000) return "EXPIRED"
  return "IN_EFFECT"
}

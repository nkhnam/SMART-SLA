import { fmtVnd } from "@/lib/terms"

export type PenaltyCapInfo = { percent: number; appliedVnd: number; capVnd: number; totalValueVnd: number; reachedAt: string | null; capPercent?: number; warnLevels?: number[] }

// Tiến độ tiền phạt cộng dồn so với trần 8% tổng giá trị hợp đồng (mốc báo trước 5% và 7%)
export default function PenaltyCapBar({ cap }: { cap: PenaltyCapInfo }) {
  const max = cap.capPercent ?? 8
  const marks = cap.warnLevels ?? [5, 7]
  const pct = Math.min(100, (cap.percent / max) * 100)
  const reached = !!cap.reachedAt || cap.percent >= max
  const warn = !reached && marks.some((m) => cap.percent >= m)
  const bar = reached ? "bg-rose-500" : warn ? "bg-amber-400" : "bg-emerald-400"
  return (
    <div className={`rounded-2xl border px-5 py-4 ${reached ? "border-rose-500/50 bg-rose-500/10" : warn ? "border-amber-400/40 bg-amber-400/10" : "border-slate-700/80 bg-slate-900/60"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <p className="font-bold text-white">Trần phạt {max}% tổng giá trị hợp đồng</p>
        <p className="text-slate-300">
          Đã phạt <strong className="text-white">{fmtVnd(cap.appliedVnd)}</strong> = {cap.percent}% · Trần {fmtVnd(cap.capVnd)} / tổng {fmtVnd(cap.totalValueVnd)}
        </p>
      </div>
      <div className="relative mt-3 h-2.5 rounded-full bg-slate-800">
        <div className={`h-2.5 rounded-full ${bar}`} style={{ width: `${pct}%` }} />
        {marks.map((m) => (
          <span key={m} className="absolute -top-1 h-4.5 w-0.5 bg-slate-300/70" style={{ left: `${(m / max) * 100}%` }} title={`Mốc báo trước ${m}%`} />
        ))}
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-slate-400">
        {marks.map((m) => <span key={m} className="absolute -translate-x-1/2" style={{ left: `${(m / max) * 100}%` }}>{m}%</span>)}
        <span className="absolute right-0">{max}%</span>
      </div>
      {reached ? (
        <p className="mt-2 text-sm font-semibold text-rose-200">Đã chạm trần: hợp đồng dừng, ngừng đo và không tính phạt thêm.</p>
      ) : warn ? (
        <p className="mt-2 text-sm text-amber-100">Đã vượt mốc báo trước, nhà cung cấp đã được thông báo. Chạm {max}% hợp đồng sẽ tự dừng.</p>
      ) : null}
    </div>
  )
}

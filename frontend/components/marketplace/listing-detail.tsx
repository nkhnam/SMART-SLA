"use client"

import type { Kpi, ServiceListing } from "@/lib/types"
import { Badge, fmtPercent } from "@/components/sla/ui"
import { ConditionsView } from "@/components/contracts/conditions-editor"

export const LISTING_STATUS: Record<ServiceListing["status"], { label: string; tone: "slate" | "amber" | "green" | "red" }> = {
  DRAFT: { label: "Bản nháp", tone: "slate" },
  PENDING: { label: "Chờ duyệt", tone: "amber" },
  APPROVED: { label: "Đã duyệt", tone: "green" },
  REJECTED: { label: "Bị từ chối", tone: "red" },
}

export const kpiLine = (k: Kpi) =>
  `${k.name} ${k.comparator === "GTE" ? "≥" : "≤"} ${k.target}${k.unit === "%" || k.unit === "ms" ? k.unit : ` ${k.unit}`}` +
  (k.minPercent !== null && k.minPercent !== undefined ? ` cho ≥ ${k.minPercent}% ticket` : "")

const DAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"]

// Nội dung đầy đủ của 1 dịch vụ: dùng cho Marketplace (xem chi tiết) và Admin (xem trước khi duyệt)
export default function ListingDetail({ listing }: { listing: ServiceListing }) {
  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-extrabold text-white">{listing.title}</h2>
          <Badge tone={LISTING_STATUS[listing.status].tone}>{LISTING_STATUS[listing.status].label}</Badge>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          {listing.provider?.name ? `${listing.provider.name} · ` : ""}{listing.category}
        </p>
        {listing.priceNote && <p className="mt-2 text-sm font-semibold text-emerald-300">{listing.priceNote}</p>}
        {listing.website && <a href={listing.website} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm text-blue-300">{listing.website}</a>}
      </div>
      {listing.description && <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">{listing.description}</p>}

      <div>
        <h3 className="mb-2 text-sm font-bold text-white">Cam kết SLA</h3>
        <div className="space-y-3">
          {listing.kpis.map((k) => (
            <div key={k.kpiCode} className="rounded-xl border border-slate-700/80 p-3 text-sm">
              <p className="font-semibold text-white">{kpiLine(k)}</p>
              <p className="mt-1 text-xs text-slate-400">
                Kỳ đo {Math.round(k.windowMinutes / 1440)} ngày
                {k.exclusions?.length ? ` · Không tính ${k.exclusions.map((e) => `${DAYS[e.dayOfWeek]} ${e.start}–${e.end}`).join(", ")}` : ""}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Hoàn phí:{" "}
                {k.creditTiers
                  .map((t) => (t.maxBreach === null ? `nặng hơn ${fmtPercent(t.creditBps)}` : `${k.comparator === "GTE" || k.minPercent != null ? "hụt" : "vượt"} dưới ${t.maxBreach}${k.minPercent != null ? " điểm" : ""}% → ${fmtPercent(t.creditBps)}`))
                  .join(" · ")}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">Thời hạn phản đối vi phạm: {listing.challengeWindowHours} giờ</p>
      </div>

      {!!listing.additionalConditions?.length && (
        <div>
          <h3 className="mb-2 text-sm font-bold text-white">Điều kiện bổ sung</h3>
          <ConditionsView conditions={listing.additionalConditions} />
        </div>
      )}
    </div>
  )
}

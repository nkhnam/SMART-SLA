"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

// Giải thích chi tiết từng KPI: đo thế nào, tính thế nào, khi nào phạt, ví dụ. Số liệu lấy theo giá trị đang nhập.
type Tier = { maxBreach: string; creditPercent: string }
type Props = { kpiCode: string; target: string; minPercent: string; dataSource: string; windowDays: string; tiers: Tier[]; maintenance: boolean }

const n = (s: string, d = 0) => (Number.isFinite(Number(s)) && s !== "" ? Number(s) : d)
const vn = (x: number) => x.toLocaleString("vi-VN", { maximumFractionDigits: 2 })

function tiersText(tiers: Tier[], unit: string) {
  return tiers
    .map((t, i) => {
      const name = ["Minor", "Moderate", "Severe"][i] ?? `Bậc ${i + 1}`
      return t.maxBreach === "" ? `${name}: nặng hơn → hoàn ${t.creditPercent}%` : `${name}: dưới ${t.maxBreach}${unit} → hoàn ${t.creditPercent}%`
    })
    .join(" · ")
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{title}</p>
      <div className="mt-1 space-y-1 text-[13px] leading-6 text-slate-200">{children}</div>
    </div>
  )
}

export default function KpiGuide(p: Props) {
  const [open, setOpen] = useState(true)
  const t = n(p.target)
  const mp = n(p.minPercent, 95)
  const hook = p.dataSource === "WEBHOOK"
  const win = `${p.windowDays} ngày`
  const maint = p.maintenance ? "Không tính các lần đo trong khung bảo trì đã chọn." : "Chưa chọn khung bảo trì, mọi thời điểm đều được tính."

  let body: React.ReactNode
  if (p.kpiCode === "UPTIME") {
    const down = ((100 - t) / 100) * 30 * 24 * 60
    body = (
      <>
        <Block title="Đo thế nào">
          <p>• <b>SLA-DEX tự đo:</b> gửi request GET tới URL health check của nhà cung cấp theo chu kỳ của gói (Enterprise 1 phút, Starter 5 phút). Mã HTTP dưới 400 là <b>UP</b>; từ 400 trở lên, quá 5 giây không trả lời hoặc lỗi kết nối là <b>DOWN</b>.</p>
          {hook && <p>• <b>Webhook 2 bên:</b> UptimeRobot, Datadog, CloudWatch… gửi sự kiện DOWN / UP. Ưu tiên webhook client, rồi webhook provider; SLA-DEX vẫn đo song song để đối chiếu.</p>}
        </Block>
        <Block title="Tính thế nào">
          <p>Uptime = số lần UP ÷ tổng số lần đo × 100%{hook ? " (theo webhook: thời gian hoạt động ÷ tổng thời gian)" : ""}, trong kỳ {win}. {maint}</p>
        </Block>
        <Block title="Khi nào vi phạm, phạt bao nhiêu">
          <p>Uptime thấp hơn <b>{vn(t)}%</b> là vi phạm. Mức hụt (điểm %) quyết định bậc: {tiersText(p.tiers, " điểm")}.</p>
        </Block>
        <Block title="Ví dụ">
          <p>Cam kết {vn(t)}% nghĩa là trong 30 ngày, dịch vụ chỉ được sập tối đa khoảng <b>{vn(Math.round(down))} phút</b>. Sập nhiều hơn thì tự động phát sinh hoàn phí.</p>
        </Block>
      </>
    )
  } else if (p.kpiCode === "RESPONSE_TIME") {
    body = (
      <>
        <Block title="Đo thế nào">
          <p>• <b>SLA-DEX tự đo:</b> dùng cùng lần gọi với Uptime, bấm giờ từ lúc gửi đến lúc nhận phản hồi (mili giây). Chỉ tính các lần dịch vụ UP.</p>
          {hook && <p>• <b>Webhook 2 bên:</b> công cụ của hai bên gửi {"{"}&quot;responseTimeMs&quot;: 230{"}"}. Ưu tiên webhook client, rồi webhook provider.</p>}
        </Block>
        <Block title="Tính thế nào">
          <p>Thời gian phản hồi trung bình của mọi lần đo trong kỳ {win}. {maint}</p>
        </Block>
        <Block title="Khi nào vi phạm, phạt bao nhiêu">
          <p>Trung bình vượt <b>{vn(t)} ms</b> là vi phạm. Mức vượt (% so với cam kết) quyết định bậc: {tiersText(p.tiers, "%")}.</p>
        </Block>
        <Block title="Ví dụ">
          <p>Cam kết {vn(t)} ms, đo được trung bình {vn(Math.round(t * 1.3))} ms → vượt 30% → áp dụng bậc tương ứng ở trên.</p>
        </Block>
      </>
    )
  } else if (p.kpiCode === "FIRST_RESPONSE" || p.kpiCode === "RESOLUTION_TIME") {
    const first = p.kpiCode === "FIRST_RESPONSE"
    const unit = first ? "phút" : "giờ"
    body = (
      <>
        <Block title="Đo thế nào">
          <p>• Đồng hồ chạy từ lúc <b>mở ticket</b> đến lúc {first ? <><b>bên kia trả lời lần đầu</b></> : <><b>nhà cung cấp đánh dấu đã giải quyết</b> (bên mua mở lại thì đồng hồ chạy tiếp)</>}.</p>
          <p>• <b>Chat hỗ trợ SLA-DEX:</b> bên mua mở ticket trong mục Bàn bạc → Ticket hỗ trợ.</p>
          {hook && <p>• <b>Webhook 2 bên:</b> Jira / Zendesk gửi TICKET_CREATED rồi {first ? "TICKET_RESPONDED" : "TICKET_RESOLVED"}. Ưu tiên webhook client, rồi webhook provider; chat SLA-DEX dùng để đối chiếu.</p>}
        </Block>
        <Block title="Tính thế nào">
          <p>Mỗi ticket <b>đạt</b> nếu {first ? "được phản hồi" : "được xử lý xong"} trong ≤ {vn(t)} {unit}; quá hạn mà chưa có kết quả tính là <b>không đạt</b>. KPI = % ticket đạt trong kỳ {win}. Cần tối thiểu 3 ticket mới kết luận.</p>
        </Block>
        <Block title="Khi nào vi phạm, phạt bao nhiêu">
          <p>Tỷ lệ đạt thấp hơn <b>{vn(mp)}%</b> là vi phạm. Số điểm % còn thiếu quyết định bậc: {tiersText(p.tiers, " điểm")}.</p>
        </Block>
        <Block title="Ví dụ">
          <p>20 ticket trong kỳ, 18 ticket đạt → 90% → thiếu {vn(Math.max(0, mp - 90))} điểm so với {vn(mp)}% → áp dụng bậc tương ứng.</p>
        </Block>
      </>
    )
  } else {
    body = (
      <>
        <Block title="Định nghĩa">
          <p>Thời gian từ lúc hệ thống SIEM / SOC <b>phát hiện tấn công</b> đến lúc đội SOC <b>bắt đầu xử lý</b>. Nguồn dữ liệu: webhook từ hệ thống an ninh.</p>
        </Block>
        <Block title="Khi nào vi phạm, phạt bao nhiêu">
          <p>Vượt <b>{vn(t)} phút</b> là vi phạm. Mức vượt quyết định bậc: {tiersText(p.tiers, "%")}.</p>
        </Block>
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">KPI đang phát triển: chưa đo tự động, sẽ không phát sinh vi phạm cho tới khi ra mắt.</p>
      </>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-700/80 bg-slate-800/20">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-bold text-white" aria-expanded={open}>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Cách đo và tính KPI này
      </button>
      {open && <div className="grid gap-3 border-t border-slate-700/80 px-4 py-3 md:grid-cols-2">{body}</div>}
    </div>
  )
}

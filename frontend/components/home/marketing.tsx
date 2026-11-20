"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import { ArrowRight, BadgeCheck, Blocks, Check, FileBarChart2, Percent, PenLine, Play, Radar, Star } from "lucide-react"

// Video demo: đặt NEXT_PUBLIC_DEMO_VIDEO_URL nếu muốn gắn link YouTube hoặc mp4 của dự án mới.
// Mốc thời gian (giây) để bấm tua tới từng phần của video (để null khi chưa gắn video).
const VIDEO_URL = process.env.NEXT_PUBLIC_DEMO_VIDEO_URL || ""
const CHAPTERS: { label: string; at: number | null }[] = [
  { label: "Tạo SLA từ mẫu và giải thích 5 KPI", at: null },
  { label: "Bàn bạc, hai bên ký và ghi lên Polygon", at: null },
  { label: "Giả lập sự cố, Gantt báo đỏ tức thì", at: null },
  { label: "Phân xử khiếu nại và báo cáo đối soát", at: null },
  { label: "Ticket hỗ trợ: đo phản hồi và xử lý", at: null },
]

const youtubeId = (url: string) => url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/)?.[1] ?? null

const Tag = ({ children }: { children: React.ReactNode }) => (
  <span className="text-xs font-bold uppercase tracking-[0.16em] text-blue-300">{children}</span>
)

function Head({ tag, title, desc }: { tag: string; title: string; desc?: string }) {
  return (
    <div className="mx-auto mb-10 max-w-3xl text-center">
      <Tag>{tag}</Tag>
      <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h2>
      {desc && <p className="mt-3 text-[15px] leading-7 text-slate-300">{desc}</p>}
    </div>
  )
}

// ① Hero (chỉ hiện cho khách chưa đăng nhập)
export function MarketingHero() {
  return (
    <section className="grid items-center gap-10 py-6 lg:grid-cols-[1.05fr_1fr]">
      <div>
        <Tag>Nền tảng hợp đồng SLA minh bạch</Tag>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-[clamp(36px,4.6vw,56px)] font-extrabold leading-[1.06] tracking-[-0.02em] text-white">
          SLA <span className="text-blue-300">tự giám sát, tự tính phạt</span>, bất biến dữ liệu
        </h1>
        <p className="mt-5 max-w-xl text-[17px] leading-8 text-slate-300">
          SMART-SLA tự giám sát dịch vụ của nhà cung cấp, tự tính hoàn phí khi vi phạm và ghi bằng chứng lên blockchain. Bên mua và nhà cung cấp cùng nhìn một con số.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/register" className="inline-flex h-12 items-center gap-2 rounded-xl bg-blue-600 px-5 text-[15px] font-bold text-white hover:bg-blue-500">
            Dùng thử Pilot 30 ngày <ArrowRight className="h-4 w-4" />
          </Link>
          <a href="#video-demo" className="inline-flex h-12 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-5 text-[15px] font-bold text-white">
            <Play className="h-4 w-4" /> Xem video demo
          </a>
        </div>
        <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[13px] font-semibold text-slate-300">
          {["Ghi bằng chứng trên Polygon", "Ký EIP-712 hoặc OTP", "Trần phạt 8%"].map((t) => (
            <li key={t} className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-blue-300" />{t}</li>
          ))}
        </ul>
      </div>
      <figure className="rounded-2xl border border-slate-700/80 bg-[#0b1424]/85 p-3 shadow-2xl">
        <div className="mb-2.5 flex items-center gap-1.5 px-1.5">
          <i className="h-2.5 w-2.5 rounded-full bg-slate-600" />
          <i className="h-2.5 w-2.5 rounded-full bg-slate-600" />
          <i className="h-2.5 w-2.5 rounded-full bg-slate-600" />
          <figcaption className="ml-2 text-[11px] text-slate-500">Dashboard SMART-SLA</figcaption>
        </div>
        <div className="space-y-2.5 rounded-xl border border-slate-700/80 p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Đang hiệu lực", value: "2" },
              { label: "Chờ ký", value: "1" },
              { label: "Đang vi phạm", value: "1" },
              { label: "Vi phạm chờ xử lý", value: "1" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-slate-700/80 p-2.5">
                <p className="truncate text-[10px] text-slate-400">{s.label}</p>
                <p className="mt-0.5 font-mono text-lg font-extrabold text-white">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-slate-700/80 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-bold text-white">Tiến trình hợp đồng (Gantt)</p>
              <div className="flex items-center gap-1 text-[10px] font-semibold">
                <span className="rounded-md bg-blue-600 px-2 py-0.5 text-white">1 giờ</span>
                <span className="rounded-md px-2 py-0.5 text-slate-400">24 giờ</span>
                <span className="rounded-md px-2 py-0.5 text-slate-400">Toàn hợp đồng</span>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-slate-400">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-3.5 rounded-sm bg-emerald-500/35" />Hiệu lực</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rotate-45 bg-violet-500" />Ký</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-3.5 rounded-sm bg-rose-600" />Sự cố</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-3.5 rounded-sm bg-amber-400" />Phản đối</span>
            </div>
            <div className="mt-2.5 space-y-2 border-t border-slate-800 pt-2.5 text-[11px]">
              {[
                { name: "Hosting core banking Q4", code: "SLA-4821", badge: "Đang vi phạm", incident: true },
                { name: "API Gateway thanh toán", code: "SLA-3307", badge: "Đang hiệu lực", incident: false },
                { name: "IT Support văn phòng", code: "SLA-5190", badge: "Đang hiệu lực", incident: false },
              ].map((row) => (
                <div key={row.code} className="grid grid-cols-[140px_1fr] items-center gap-2.5 sm:grid-cols-[170px_1fr]">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">{row.name}</p>
                    <p className="font-mono text-[10px] text-slate-400">{row.code} · {row.badge}</p>
                  </div>
                  <div className="relative h-6 rounded-md bg-slate-800/40">
                    <span className="absolute left-[8%] right-[6%] top-1/2 h-2 -translate-y-1/2 rounded-sm bg-emerald-500/30" />
                    <span className="absolute left-[22%] top-0.5 h-2 w-2 rotate-45 bg-violet-500" />
                    <span className="absolute left-[27%] top-0.5 h-2 w-2 rotate-45 bg-violet-500" />
                    {row.incident && (
                      <>
                        <span className="absolute left-[72%] top-1/2 h-3.5 w-[10%] -translate-y-1/2 rounded-sm bg-rose-600" />
                        <span className="absolute bottom-0.5 left-[74%] h-1 w-[20%] rounded-sm bg-amber-400" />
                      </>
                    )}
                    <span className="absolute inset-y-0 left-[86%] w-0.5 bg-blue-600" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </figure>
    </section>
  )
}

// ② Số liệu nổi bật (đều là thông số thật của hệ thống)
function Stats() {
  const items = [
    { v: "5", t: "KPI đo tự động: uptime, phản hồi, ticket, sự cố" },
    { v: "1 phút", t: "chu kỳ đo nhanh nhất (gói Enterprise)" },
    { v: "4", t: "mẫu hợp đồng theo ngành có sẵn" },
    { v: "100%", t: "vụ vi phạm có bằng chứng on-chain" },
  ]
  return (
    <section className="grid grid-cols-2 overflow-hidden rounded-2xl border border-slate-700/80 bg-[#0b1424]/85 lg:grid-cols-4">
      {items.map((s, i) => (
        <div key={s.t} className={`p-6 ${i ? "border-l border-slate-700/80" : ""}`}>
          <b className="font-mono text-3xl font-semibold text-blue-300">{s.v}</b>
          <p className="mt-1 text-sm font-semibold text-slate-300">{s.t}</p>
        </div>
      ))}
    </section>
  )
}

// ③ Video demo nhúng trực tiếp
function VideoDemo() {
  const yt = youtubeId(VIDEO_URL)
  const [start, setStart] = useState<number | null>(null)
  const mp4Ref = useRef<HTMLVideoElement>(null)
  const seek = (at: number | null) => {
    if (at === null) return
    if (yt) setStart(at)
    else if (mp4Ref.current) {
      mp4Ref.current.currentTime = at
      void mp4Ref.current.play()
    }
  }
  return (
    <section id="video-demo" className="scroll-mt-24">
      <Head
        tag="Xem SMART-SLA hoạt động"
        title="Từ ký hợp đồng đến tự tính phạt trong vài phút"
        desc="Video quay trên hệ thống thật: tạo SLA, hai bên ký, giả lập sự cố, hệ thống phát hiện vi phạm, ghi bằng chứng lên Polygon và chốt hoàn phí."
      />
      <div className="grid items-center gap-7 lg:grid-cols-[1.6fr_1fr]">
        <div className="relative aspect-video overflow-hidden rounded-2xl border border-slate-700/80 shadow-2xl" style={{ background: VIDEO_URL ? "#111" : undefined }}>
          {yt ? (
            <iframe
              key={start ?? 0}
              src={`https://www.youtube-nocookie.com/embed/${yt}?rel=0${start !== null ? `&start=${start}&autoplay=1` : ""}`}
              title="Video demo SMART-SLA"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          ) : VIDEO_URL ? (
            <video ref={mp4Ref} src={VIDEO_URL} controls preload="metadata" className="absolute inset-0 h-full w-full bg-black" />
          ) : (
            <div className="app-grid relative flex h-full w-full items-center justify-center">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.88),transparent_70%)]" />
              <div className="relative z-10 text-center">
                <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-blue-600 text-white shadow-xl"><Play className="ml-1 h-8 w-8" /></span>
                <p className="mt-4 text-sm font-semibold text-white">Video demo sẽ được cập nhật</p>
              </div>
            </div>
          )}
        </div>
        <div>
          <Tag>Nội dung video</Tag>
          <ol className="mt-3 space-y-2.5">
            {CHAPTERS.map((c, i) => (
              <li key={c.label}>
                <button
                  type="button"
                  onClick={() => seek(c.at)}
                  disabled={c.at === null || !VIDEO_URL}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-700/80 bg-[#0b1424]/85 px-4 py-3 text-left text-sm font-semibold text-white enabled:hover:border-blue-500 disabled:cursor-default"
                >
                  <span className="font-mono text-xs text-blue-300">{c.at !== null ? `${Math.floor(c.at / 60)}:${String(c.at % 60).padStart(2, "0")}` : `0${i + 1}`}</span>
                  {c.label}
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

// ④ Giải pháp
function Solutions() {
  const items = [
    { icon: Radar, t: "Đo độc lập", d: "Oracle của SMART-SLA tự gọi dịch vụ, nhận thêm dữ liệu từ UptimeRobot, Datadog, Jira của hai bên và đối chiếu chéo.", href: "/create-sla" },
    { icon: Percent, t: "Tự tính phạt", d: "Xếp bậc Minor / Moderate / Severe, quy ra tiền hoàn phí, có thời hạn phản đối và admin phân xử.", href: "/dashboard" },
    { icon: FileBarChart2, t: "Báo cáo đối soát", d: "Biên bản theo kỳ: KPI cam kết so với đo được, số tiền phải thanh toán, xuất PDF một chạm.", href: "/contracts" },
    { icon: Blocks, t: "Kiểm chứng blockchain", d: "Hash điều khoản và bằng chứng nằm trên Polygon. Ai cũng tự kiểm tra được.", href: "/contracts" },
    { icon: PenLine, t: "Ký số và bàn bạc", d: "Ký bằng địa chỉ ví crypto hoặc OTP email. Bàn bạc điều khoản trong chat, AI tóm tắt các điểm đã thống nhất.", href: "/negotiations" },
    { icon: Star, t: "Marketplace uy tín", d: "Xếp hạng nhà cung cấp theo chất lượng và hiệu suất cung cấp dịch vụ cho khách hàng (uptime, số lần vi phạm, tốc độ phản hồi), đo tự động, không theo quảng cáo.", href: "/marketplace" },
  ]
  return (
    <section>
      <Head tag="Giải pháp" title="Một nền tảng cho cả vòng đời hợp đồng SLA" desc="Từ soạn điều khoản, ký kết, giám sát đến đối soát thanh toán, không cần bảng tính hay email qua lại." />
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {items.map(({ icon: Icon, t, d, href }) => (
          <Link key={t} href={href} className="group rounded-2xl border border-slate-700/80 bg-[#0b1424]/85 p-6 transition hover:-translate-y-0.5">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-500/10 text-blue-300"><Icon className="h-5 w-5" /></span>
            <h3 className="mt-4 text-lg font-bold text-white">{t}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">{d}</p>
            <span className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-blue-300">Tìm hiểu <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></span>
          </Link>
        ))}
      </div>
    </section>
  )
}

// ⑤ 5 KPI giải thích chi tiết
const KPIS = [
  {
    cat: "Hạ tầng", name: "Uptime", target: "≥ 99,9%",
    how: "SMART-SLA gửi request tới URL health check của nhà cung cấp theo chu kỳ (1–15 phút tuỳ gói). Mã HTTP dưới 400 là UP; từ 400 trở lên, quá 5 giây hoặc lỗi kết nối là DOWN.",
    calc: "Số lần UP ÷ tổng số lần đo × 100% trong kỳ 30 ngày, không tính khung bảo trì đã thoả thuận.",
    pen: "Hụt dưới 0,91 điểm → hoàn 5% · dưới 4,91 điểm → 10% · nặng hơn → 25% phí tháng (mẫu Cloud Hosting).",
    ex: "Cam kết 99,9% = được sập tối đa khoảng 43 phút / 30 ngày. Sập 2 giờ → uptime 99,72%, hụt 0,18 điểm → hoàn 5%.",
  },
  {
    cat: "Hiệu năng", name: "Thời gian phản hồi hệ thống", target: "≤ 200 ms",
    how: "Dùng cùng lần gọi với Uptime, bấm giờ từ lúc gửi đến lúc nhận phản hồi (chỉ tính lần UP). Hoặc công cụ của hai bên gửi responseTimeMs qua webhook.",
    calc: "Trung bình thời gian phản hồi trong kỳ, không tính khung bảo trì.",
    pen: "Vượt dưới 50% → hoàn 5% · dưới 100% → 10% · nặng hơn → 20%.",
    ex: "Cam kết 200 ms, đo được trung bình 260 ms → vượt 30% → hoàn 5%.",
  },
  {
    cat: "Hỗ trợ", name: "Thời gian phản hồi ticket", target: "≤ 15 phút · ≥ 95% ticket",
    how: "Đồng hồ chạy từ lúc khách mở ticket (chat hỗ trợ SMART-SLA hoặc Jira / Zendesk) đến lúc nhà cung cấp trả lời lần đầu.",
    calc: "Mỗi ticket đạt nếu được trả lời trong 15 phút; quá hạn chưa trả lời là không đạt. KPI = % ticket đạt, cần tối thiểu 3 ticket.",
    pen: "Thiếu dưới 5 điểm so với 95% → hoàn 3% · dưới 15 điểm → 7% · nặng hơn → 15%.",
    ex: "20 ticket, 18 đạt → 90% → thiếu 5 điểm → hoàn 7%.",
  },
  {
    cat: "Hỗ trợ", name: "Thời gian xử lý ticket", target: "≤ 4 giờ · ≥ 95% ticket",
    how: "Từ lúc mở ticket đến lúc nhà cung cấp đánh dấu đã giải quyết. Bên mua bấm “mở lại” thì đồng hồ chạy tiếp.",
    calc: "Mỗi ticket đạt nếu được xử lý xong trong 4 giờ. KPI = % ticket đạt trong kỳ.",
    pen: "Thiếu dưới 5 điểm → hoàn 5% · dưới 15 điểm → 10% · nặng hơn → 20%.",
    ex: "10 ticket, 9 xử lý kịp → 90% → thiếu 5 điểm → hoàn 10%.",
  },
  {
    cat: "An ninh", name: "Ứng phó sự cố an ninh", target: "≤ 30 phút", soon: true,
    how: "Từ lúc hệ thống SIEM / SOC phát hiện tấn công (gửi qua webhook) đến lúc đội SOC bắt đầu xử lý.",
    calc: "Thời gian ứng phó của các sự cố trong kỳ so với cam kết.",
    pen: "Vượt dưới 50% → hoàn 10% · dưới 100% → 20% · nặng hơn → 30%.",
    ex: "Cam kết 30 phút, SOC bắt đầu xử lý sau 50 phút → vượt 67% → hoàn 20%.",
  },
]

function Kpis() {
  return (
    <section id="kpi">
      <Head
        tag="Phần lõi"
        title="5 KPI được đo và tính phạt tự động"
        desc="Mỗi KPI có cách đo rõ ràng, mức cam kết và bậc phạt Minor / Moderate / Severe do hai bên thống nhất. Nguồn dữ liệu: SMART-SLA tự đo, hoặc webhook từ công cụ của hai bên (UptimeRobot, Datadog, Jira…), SMART-SLA vẫn đo song song để đối chiếu."
      />
      <div className="space-y-3.5">
        {KPIS.map((k) => (
          <article key={k.name} className="grid overflow-hidden rounded-2xl border border-slate-700/80 bg-[#0b1424]/85 md:grid-cols-[240px_1fr]">
            <div className="border-b border-slate-700/80 p-5 md:border-b-0 md:border-r">
              <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">{k.cat}</p>
              <h3 className="mt-1.5 text-lg font-bold text-white">{k.name}</h3>
              <p className="mt-2 font-mono text-lg text-blue-300">{k.target}</p>
              {k.soon && <span className="mt-2 inline-block rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">Sắp ra mắt</span>}
            </div>
            <div className="grid gap-x-7 gap-y-2.5 p-5 text-[13.5px] leading-6 text-slate-300 md:grid-cols-2">
              <p><b className="text-white">Đo:</b> {k.how}</p>
              <p><b className="text-white">Tính:</b> {k.calc}</p>
              <p><b className="text-white">Phạt:</b> {k.pen}</p>
              <p className="rounded-lg border border-dashed border-slate-600 px-3 py-2"><b className="text-white">Ví dụ:</b> {k.ex}</p>
            </div>
          </article>
        ))}
      </div>
      <p className="mt-5 text-center text-[13px] text-slate-400">Trần phạt tối đa 8% tổng giá trị hợp đồng · cảnh báo nhà cung cấp ở 5% và 7% · mỗi vụ vi phạm có thời hạn phản đối trước khi chốt.</p>
    </section>
  )
}

// ⑥ Quy trình
function Steps() {
  const items = [
    { t: "Tạo SLA", d: "Chọn mẫu theo ngành, chỉnh KPI và bậc phạt, không cần viết code." },
    { t: "Hai bên ký", d: "Ký bằng địa chỉ ví crypto hoặc OTP. Đủ chữ ký, điều khoản được ghi lên Polygon." },
    { t: "Tự giám sát", d: "Oracle đo liên tục, phát hiện vi phạm và báo cả hai bên ngay." },
    { t: "Đối soát", d: "Hết hạn phản đối, kết quả tự chốt và vào biên bản thanh toán." },
  ]
  return (
    <section>
      <Head tag="Cách hoạt động" title="Bắt đầu trong 10 phút" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {items.map((s, i) => (
          <div key={s.t} className="rounded-2xl border border-slate-700/80 bg-[#0b1424]/85 p-6">
            <span className="font-mono text-sm font-semibold text-blue-300">0{i + 1}</span>
            <h3 className="mt-2 text-lg font-bold text-white">{s.t}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">{s.d}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

// ⑦ Dành cho ai
function Audience() {
  const cols = [
    { tag: "Bên mua dịch vụ", t: "Trả tiền đúng chất lượng nhận được", items: ["Không phụ thuộc báo cáo nhà cung cấp tự khai", "Hoàn phí tự động khi dịch vụ không đạt cam kết", "Bằng chứng sẵn sàng khi cần thanh lý hợp đồng"] },
    { tag: "Nhà cung cấp", t: "Chứng minh chất lượng bằng số liệu", items: ["Điểm uy tín đo thật để thắng hợp đồng mới", "Trần phạt 8%, cảnh báo sớm ở 5% và 7%", "Quyền phản đối kèm bằng chứng, có người phân xử"] },
  ]
  return (
    <section className="grid gap-5 md:grid-cols-2">
      {cols.map((c) => (
        <div key={c.tag} className="rounded-2xl border border-slate-700/80 bg-[#0b1424]/85 p-7">
          <Tag>{c.tag}</Tag>
          <h3 className="mt-2 text-xl font-bold text-white">{c.t}</h3>
          <ul className="mt-3 divide-y divide-dashed divide-slate-700">
            {c.items.map((x) => (
              <li key={x} className="flex items-center gap-2 py-2.5 text-sm text-white"><BadgeCheck className="h-4 w-4 shrink-0 text-blue-300" />{x}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

// ⑧ Bảng giá (đúng các gói đang có)
function Pricing() {
  const plans = [
    { n: "Pilot", p: "0 ₫", s: "30 ngày, mỗi doanh nghiệp 1 lần", d: "Dùng thử đầy đủ quy trình với chu kỳ đo 15 phút." },
    { n: "Pay as you go", p: "500.000 ₫", s: "mỗi hợp đồng tạo mới", d: "Phù hợp doanh nghiệp ít hợp đồng." },
    { n: "Starter", p: "1.500.000 ₫", s: "/ tháng", d: "Đo 5 phút / lần, huy hiệu uy tín trên Marketplace.", hot: true },
    { n: "Enterprise", p: "3–10 triệu ₫", s: "/ tháng, tuỳ quy mô", d: "Đo mỗi phút, ưu tiên hiển thị trên Marketplace." },
  ]
  return (
    <section id="bang-gia">
      <Head tag="Bảng giá" title="Chọn gói phù hợp quy mô" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((p) => (
          <Link key={p.n} href="/pricing" className={`rounded-2xl border border-slate-700/80 bg-[#0b1424]/85 p-6 ${p.hot ? "shadow-xl" : ""}`} style={p.hot ? { borderColor: "#111113", borderWidth: 2 } : undefined}>
            {p.hot && <span className="mb-2 inline-block rounded-full bg-blue-500/10 px-2.5 py-0.5 text-[11px] font-bold text-blue-300">Phổ biến</span>}
            <h3 className="text-lg font-bold text-white">{p.n}</h3>
            <p className="mt-2 font-mono text-2xl text-blue-300">{p.p}</p>
            <p className="text-xs text-slate-400">{p.s}</p>
            <p className="mt-3 text-sm leading-6 text-slate-300">{p.d}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}

// ⑨ Kêu gọi hành động
function Cta({ loggedIn }: { loggedIn: boolean }) {
  return (
    <section className="flex flex-col items-start justify-between gap-5 rounded-3xl px-8 py-10 sm:flex-row sm:items-center sm:px-12" style={{ background: "linear-gradient(135deg, rgba(24,24,27,0.96) 0%, rgba(9,9,11,0.98) 55%, rgba(0,0,0,1) 100%)", color: "#fff", border: "1px solid rgba(255,255,255,0.16)", boxShadow: "0 24px 60px -12px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.22)" }}>
      <div>
        <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold" style={{ color: "#fff" }}>Đưa hợp đồng SLA của bạn lên SMART-SLA</h2>
        <p className="mt-2" style={{ color: "rgba(255,255,255,.85)" }}>Dùng thử miễn phí 30 ngày với gói Pilot.</p>
      </div>
      <Link href={loggedIn ? "/create-sla" : "/register"} className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-white px-6 font-bold text-[#09090b]">
        {loggedIn ? "Tạo hợp đồng" : "Bắt đầu ngay"} <ArrowRight className="h-4 w-4" />
      </Link>
    </section>
  )
}

// Các khối marketing bên dưới (cho mọi người xem)
export default function MarketingSections({ loggedIn }: { loggedIn: boolean }) {
  return (
    <div className="mt-16 space-y-20">
      <Stats />
      <VideoDemo />
      <Solutions />
      <Kpis />
      <Steps />
      <Audience />
      <Pricing />
      <Cta loggedIn={loggedIn} />
    </div>
  )
}

import "./globals.css";
import type { Metadata } from "next";

const TITLE = "SMART-SLA | Trust Protocol"
const DESCRIPTION = "Nền tảng quản trị và đối soát SLA, bằng chứng ghi trên Polygon"

// Domain gốc để LinkedIn, Facebook, Zalo đọc được đường dẫn tuyệt đối của ảnh xem trước.
// Ưu tiên NEXT_PUBLIC_SITE_URL, sau đó domain production do Vercel cấp.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://shadow-byte-beta.vercel.app")

// Ảnh xem trước lấy từ app/opengraph-image.png và app/twitter-image.png (Next.js tự gắn thẻ og:image)
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    locale: "vi_VN",
    siteName: "SMART-SLA",
    url: "/",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        {/* Tiêu đề: Bricolage Grotesque 700/800 · Nội dung: Be Vietnam Pro · Số liệu: JetBrains Mono 500 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=JetBrains+Mono:wght@500;600&display=swap"
        />
      </head>
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}

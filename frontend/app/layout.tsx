import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shadow Byte | Trust Protocol",
  description: "Nền tảng quản trị và đối soát SLA, bằng chứng ghi trên Polygon",
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

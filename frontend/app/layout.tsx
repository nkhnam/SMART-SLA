import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SMART-SLA | Verifiable SLA Infrastructure",
  description: "A clear workspace for service commitments, monitoring evidence, and dispute review on Avalanche.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=JetBrains+Mono:wght@500;600&display=swap"
        />
      </head>
      <body className="app-theme min-h-screen antialiased">{children}</body>
    </html>
  );
}

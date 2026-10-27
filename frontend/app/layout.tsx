import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SLA-DEX | Verifiable SLA Infrastructure",
  description: "A clear workspace for service commitments, monitoring evidence, and dispute review on Avalanche.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

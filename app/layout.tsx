import type { Metadata, Viewport } from "next";
import { Fraunces, Public_Sans } from "next/font/google";
import { ObservabilityInit } from "@/components/features/observability/observability-init";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["opsz", "SOFT", "WONK"],
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "StockFlow ZW",
  description:
    "Offline-first stock, sales and business management for Zimbabwean SMEs.",
};

export const viewport: Viewport = {
  themeColor: "#d9752c",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${publicSans.variable}`}>
      <body className="antialiased">
        <ObservabilityInit />
        {children}
      </body>
    </html>
  );
}

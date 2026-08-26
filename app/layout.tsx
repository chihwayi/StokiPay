import type { Metadata, Viewport } from "next";
import { ObservabilityInit } from "@/components/features/observability/observability-init";
import "./globals.css";

export const metadata: Metadata = {
  title: "StockFlow ZW",
  description:
    "Offline-first stock, sales and business management for Zimbabwean SMEs.",
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <ObservabilityInit />
        {children}
      </body>
    </html>
  );
}

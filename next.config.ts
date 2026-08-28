import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  reactCompiler: true,
};

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  // PowerSync's wa-sqlite WASM binaries (~2.5MB each, ADR 0002) exceed
  // Workbox's 2MB default precache limit — without raising it they're
  // silently excluded from the precache manifest, which would defeat
  // "offline-safe from the first visit" for every local-first write path.
  maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
});

export default withSerwist(nextConfig);

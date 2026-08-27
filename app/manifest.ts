import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StockFlow ZW",
    short_name: "StockFlow",
    description:
      "Offline-first stock, sales and business management for Zimbabwean SMEs.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf3e7",
    theme_color: "#d9752c",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}

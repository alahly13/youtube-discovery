import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "YouTube Discovery Research Terminal",
    short_name: "YouTube Discovery",
    description:
      "Manifest-first YouTube public metadata discovery, filtering, saving, exporting, and scoped AI analysis.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#09090d",
    theme_color: "#09090d",
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

import type { MetadataRoute } from "next";
import { GAME } from "../lib/config";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: GAME.name,
    short_name: GAME.name,
    description: "Open a hideout in Miami and earn VOLTA, SENT and VOID. On Volta · Elysium.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b1634",
    theme_color: "#0b1634",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}

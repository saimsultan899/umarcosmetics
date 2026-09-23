import type { NextConfig } from "next";
import pkg from "./package.json";

/**
 * `output: "standalone"` is required for the Electron desktop package, but it
 * breaks Vercel file tracing (ENOENT .next/next-server.js.nft.json).
 * Enable it only when packaging for Electron.
 */
const useStandalone =
  process.env.ELECTRON_BUILD === "1" ||
  process.env.NEXT_OUTPUT === "standalone";

const nextConfig: NextConfig = {
  ...(useStandalone ? { output: "standalone" as const } : {}),
  serverExternalPackages: ["better-sqlite3", "electron"],
  // Expose the app version (single source of truth = package.json) so the
  // version endpoint and PWA update-check can compare against the server.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;

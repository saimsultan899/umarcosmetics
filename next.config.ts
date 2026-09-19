import type { NextConfig } from "next";

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
};

export default nextConfig;

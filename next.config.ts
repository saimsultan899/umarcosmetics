import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Standalone output bundles the server for Electron deployment */
  output: "standalone",
};

export default nextConfig;

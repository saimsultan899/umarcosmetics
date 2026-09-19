/**
 * Skip native Electron deps install on Vercel / CI web builds.
 * Electron packaging still runs this locally via electron:build scripts.
 */
if (process.env.VERCEL || process.env.CI === "true") {
  console.log("Skipping electron-builder install-app-deps (web/CI build)");
  process.exit(0);
}

const { execSync } = require("child_process");
try {
  execSync("electron-builder install-app-deps", { stdio: "inherit" });
} catch (err) {
  console.warn(
    "electron-builder install-app-deps failed (ok for web-only installs):",
    err instanceof Error ? err.message : err,
  );
}

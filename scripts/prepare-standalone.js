const fs = require("fs");
const path = require("path");

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

const root = path.resolve(__dirname, "..");
const standaloneDir = path.join(root, ".next", "standalone");
const nextModule = path.join(standaloneDir, "node_modules", "next");
const serverJs = path.join(standaloneDir, "server.js");

console.log("Preparing Next.js standalone package for Electron...");

if (!fs.existsSync(standaloneDir)) {
  console.error(
    "ERROR: .next/standalone not found. Run `next build` first (output: 'standalone').",
  );
  process.exit(1);
}

if (!fs.existsSync(serverJs)) {
  console.error("ERROR: .next/standalone/server.js missing.");
  process.exit(1);
}

if (!fs.existsSync(nextModule)) {
  console.error(
    "ERROR: .next/standalone/node_modules/next missing.\n" +
      "The Electron EXE will fail with: Cannot find module 'next'.\n" +
      "Re-run a clean `next build` with output: 'standalone'.",
  );
  process.exit(1);
}

// 1. Copy .next/static to standalone/.next/static
const staticSrc = path.join(root, ".next", "static");
const staticDest = path.join(standaloneDir, ".next", "static");
copyDir(staticSrc, staticDest);
console.log("  Copied .next/static -> .next/standalone/.next/static");

// 2. Copy public to standalone/public
const publicSrc = path.join(root, "public");
const publicDest = path.join(standaloneDir, "public");
copyDir(publicSrc, publicDest);
console.log("  Copied public -> .next/standalone/public");

// 3. Copy .env.local to standalone/.env.local (Supabase keys for the local server)
const envSrc = path.join(root, ".env.local");
const envDest = path.join(standaloneDir, ".env.local");
if (fs.existsSync(envSrc)) {
  fs.copyFileSync(envSrc, envDest);
  console.log("  Copied .env.local -> .next/standalone/.env.local");
} else {
  console.warn(
    "  WARNING: .env.local not found — packaged app may fail auth/API calls.",
  );
}

console.log("  Verified node_modules/next is present.");
console.log("Standalone package ready!");

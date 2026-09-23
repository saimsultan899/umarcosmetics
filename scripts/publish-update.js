/**
 * After `electron:build`, print the files that must be uploaded to the
 * generic electron-updater feed (electron-builder.json → publish.url).
 *
 * The offline shop clients poll this feed when they next have connectivity.
 * Uploading a new latest.yml + installer is what "pushes" a version to them.
 * Local SQLite (userData/data) is never part of this upload.
 */
const fs = require("fs");
const path = require("path");
const pkg = require("../package.json");
const builder = require("../electron-builder.json");

const outDir = path.resolve(__dirname, "..", builder.directories?.output || "dist-electron");
const feedUrl = builder.publish?.[0]?.url || "(set publish.url in electron-builder.json)";

const wanted = [];
if (fs.existsSync(outDir)) {
  for (const name of fs.readdirSync(outDir)) {
    if (/^(latest.*\.yml|.*\.(exe|dmg|AppImage|deb|blockmap))$/i.test(name)) {
      wanted.push(name);
    }
  }
}

console.log("");
console.log(`Release ${pkg.version} — upload to the update feed:`);
console.log(`  ${feedUrl}`);
console.log("");
if (wanted.length === 0) {
  console.log(`  No artifacts found in ${outDir}`);
  console.log("  Run: npm run electron:build");
} else {
  for (const name of wanted) {
    console.log(`  ${path.join(outDir, name)}`);
  }
}
console.log("");
console.log("Bump package.json version before each release so clients see a newer build.");
console.log("Do not copy userData / umar-local.sqlite — that stays on the shop PC.");
console.log("");

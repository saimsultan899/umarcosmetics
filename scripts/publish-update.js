/**
 * Publish the Windows installer so shop PCs can update.
 *
 * The website update (git push) refreshes the browser only.
 * The desktop app updates from a GitHub release: latest.yml + the setup exe.
 * Shop PCs download it from the website feed the next time they are online.
 * Their local database is not part of this upload.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const pkg = require("../package.json");
const builder = require("../electron-builder.json");

const outDir = path.resolve(__dirname, "..", builder.directories?.output || "dist-electron");
const tag = `v${pkg.version}`;
const repo = "saimsultan899/umarcosmetics";

function releaseFiles() {
  if (!fs.existsSync(outDir)) return [];
  return fs
    .readdirSync(outDir)
    .filter((name) => /^(latest\.yml|.*\.(exe|blockmap))$/i.test(name))
    .map((name) => path.join(outDir, name));
}

const files = releaseFiles();
console.log("");
console.log(`Desktop release ${tag}`);
console.log(`Shop PCs read https://umarcosmetics.vercel.app/latest.yml`);
console.log("");

if (!files.some((file) => path.basename(file) === "latest.yml") || !files.some((file) => file.endsWith(".exe"))) {
  console.log("Build the installer first:");
  console.log("  npm run electron:build");
  console.log("");
  process.exit(1);
}

for (const file of files) console.log(`  ${file}`);
console.log("");

function gh(args) {
  execFileSync("gh", args, { stdio: "inherit" });
}

let exists = false;
try {
  execFileSync("gh", ["release", "view", tag, "--repo", repo], { stdio: "ignore" });
  exists = true;
} catch {
  exists = false;
}

if (!exists) {
  gh([
    "release",
    "create",
    tag,
    "--repo",
    repo,
    "--title",
    `Umar Distribution ${pkg.version}`,
    "--notes",
    `Desktop update ${pkg.version}. Shop data on each PC is kept.`,
    ...files,
  ]);
} else {
  gh(["release", "upload", tag, "--repo", repo, "--clobber", ...files]);
}

console.log("");
console.log("Published. Online desktop apps will offer Restart & update.");
console.log("Do not upload the shop database. It stays on that computer.");
console.log("");

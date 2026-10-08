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
  const version = String(pkg.version);
  return fs
    .readdirSync(outDir)
    .filter((name) => {
      if (name === "latest.yml") return true;
      if (!name.includes(version)) return false;
      if (/uninstaller/i.test(name)) return false;
      return /\.(exe|blockmap)$/i.test(name);
    })
    .map((name) => path.join(outDir, name));
}

function ghCommand() {
  if (process.platform !== "win32") return "gh";
  const candidates = [
    "gh",
    path.join(process.env.ProgramFiles || "C:\\Program Files", "GitHub CLI", "gh.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "GitHub CLI", "gh.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "GitHub CLI", "gh.exe"),
  ];
  for (const candidate of candidates) {
    if (candidate === "gh") continue;
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return "gh";
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

const ghBin = ghCommand();

function gh(args) {
  execFileSync(ghBin, args, { stdio: "inherit" });
}

let exists = false;
try {
  execFileSync(ghBin, ["release", "view", tag, "--repo", repo], { stdio: "ignore" });
  exists = true;
} catch (err) {
  if (err && err.code === "ENOENT") {
    console.log("GitHub CLI was not found. Install it, then run this again:");
    console.log("  winget install --id GitHub.cli");
    console.log("  gh auth login");
    console.log("");
    process.exit(1);
  }
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

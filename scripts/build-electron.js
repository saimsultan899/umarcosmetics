/**
 * Electron production build: Next standalone → prepare → electron-builder.
 * Sets ELECTRON_BUILD so next.config enables output: "standalone".
 */
process.env.ELECTRON_BUILD = "1";

const { execSync } = require("child_process");
const args = process.argv.slice(2);
const builderArgs = args.length ? args.join(" ") : "--win";

execSync("next build", { stdio: "inherit", env: process.env });
execSync("node scripts/prepare-standalone.js", {
  stdio: "inherit",
  env: process.env,
});
execSync(`electron-builder ${builderArgs}`, {
  stdio: "inherit",
  env: process.env,
});

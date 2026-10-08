/**
 * Desktop installer feed.
 *
 * Shop PCs already ask https://umarcosmetics.vercel.app/latest.yml.
 * That file is the GitHub release manifest, with download links rewritten
 * to the release itself so the installer is not stored on the website.
 */

export const DESKTOP_RELEASE_REPO = "saimsultan899/umarcosmetics";

export const DESKTOP_UPDATE_SITE = "https://umarcosmetics.vercel.app";

export function githubLatestReleaseApi() {
  return `https://api.github.com/repos/${DESKTOP_RELEASE_REPO}/releases/latest`;
}

export type DesktopInstallerInfo = {
  available: boolean;
  version: string | null;
  filename: string | null;
  downloadUrl: string | null;
};

type GithubAsset = { name?: string; browser_download_url?: string };
type GithubRelease = { tag_name?: string; assets?: GithubAsset[] };

/** Latest published Windows installer, or an empty result when none exists. */
export async function fetchLatestDesktopInstaller(): Promise<DesktopInstallerInfo> {
  const empty: DesktopInstallerInfo = {
    available: false,
    version: null,
    filename: null,
    downloadUrl: null,
  };
  const releaseRes = await fetch(githubLatestReleaseApi(), {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "umar-distributor-updater",
    },
    cache: "no-store",
  });
  if (!releaseRes.ok) return empty;
  const release = (await releaseRes.json()) as GithubRelease;
  const exe = (release.assets || []).find(
    (asset) =>
      typeof asset.name === "string" &&
      asset.name.toLowerCase().endsWith(".exe") &&
      !asset.name.toLowerCase().endsWith(".blockmap"),
  );
  if (!exe?.name || !exe.browser_download_url) return empty;
  const version = (release.tag_name || "").replace(/^v/i, "") || null;
  return {
    available: true,
    version,
    filename: exe.name,
    downloadUrl: exe.browser_download_url,
  };
}

/** Turn electron-builder's relative file names into GitHub release downloads. */
export function absolutizeUpdateYaml(yml: string, tag: string) {
  const base = `https://github.com/${DESKTOP_RELEASE_REPO}/releases/download/${encodeURIComponent(tag)}/`;
  return yml.replace(/^([ \t]*(?:-\s*)?(?:url|path):[ \t]*)(\S+)[ \t]*$/gm, (_match, prefix, file) => {
    const name = String(file).replace(/^['"]|['"]$/g, "");
    if (/^https?:\/\//i.test(name)) return `${prefix}${name}`;
    return `${prefix}${base}${encodeURIComponent(name)}`;
  });
}

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

/** Turn electron-builder's relative file names into GitHub release downloads. */
export function absolutizeUpdateYaml(yml: string, tag: string) {
  const base = `https://github.com/${DESKTOP_RELEASE_REPO}/releases/download/${encodeURIComponent(tag)}/`;
  return yml.replace(/^([ \t]*(?:-\s*)?(?:url|path):[ \t]*)(\S+)[ \t]*$/gm, (_match, prefix, file) => {
    const name = String(file).replace(/^['"]|['"]$/g, "");
    if (/^https?:\/\//i.test(name)) return `${prefix}${name}`;
    return `${prefix}${base}${encodeURIComponent(name)}`;
  });
}

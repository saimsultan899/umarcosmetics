import { absolutizeUpdateYaml, githubLatestReleaseApi } from "@/lib/desktop/update-feed";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type GithubAsset = { name?: string; browser_download_url?: string };
type GithubRelease = { tag_name?: string; assets?: GithubAsset[] };

/**
 * electron-updater feed. The public address is /latest.yml (rewritten here).
 * A missing release is plain text, never the login page.
 */
export async function GET() {
  try {
    const releaseRes = await fetch(githubLatestReleaseApi(), {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "umar-distributor-updater",
      },
      cache: "no-store",
    });
    if (releaseRes.status === 404) {
      return new NextResponse("No desktop update has been published.", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    if (!releaseRes.ok) {
      return new NextResponse("Update feed is temporarily unavailable.", {
        status: 502,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    const release = (await releaseRes.json()) as GithubRelease;
    const tag = release.tag_name || "";
    const asset = (release.assets || []).find((item) => item.name === "latest.yml");
    if (!tag || !asset?.browser_download_url) {
      return new NextResponse("No desktop update has been published.", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    const ymlRes = await fetch(asset.browser_download_url, {
      headers: { "User-Agent": "umar-distributor-updater", Accept: "application/octet-stream" },
      cache: "no-store",
    });
    if (!ymlRes.ok) {
      return new NextResponse("Update feed is temporarily unavailable.", {
        status: 502,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    const yml = absolutizeUpdateYaml(await ymlRes.text(), tag);
    return new NextResponse(yml, {
      status: 200,
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch {
    return new NextResponse("Update feed is temporarily unavailable.", {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}

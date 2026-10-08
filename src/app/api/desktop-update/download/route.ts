import { fetchLatestDesktopInstaller } from "@/lib/desktop/update-feed";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Send the browser to the latest Windows installer. */
export async function GET() {
  try {
    const info = await fetchLatestDesktopInstaller();
    if (!info.available || !info.downloadUrl) {
      return NextResponse.json(
        { error: "The Windows installer has not been published yet." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.redirect(info.downloadUrl, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "The installer could not be reached. Try again when you are online." },
      { status: 502 },
    );
  }
}

import { fetchLatestDesktopInstaller } from "@/lib/desktop/update-feed";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const info = await fetchLatestDesktopInstaller();
    return NextResponse.json(info, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch {
    return NextResponse.json(
      { available: false, version: null, filename: null, downloadUrl: null },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}

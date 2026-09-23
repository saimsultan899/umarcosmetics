import { NextResponse } from "next/server";

/**
 * Lightweight app-version endpoint.
 *
 * Serves as the "version check against server" signal for the auto-update
 * mechanism. Two consumers:
 *  - PWA (browser): compares its running build against this value to decide
 *    whether to refresh the cached app shell.
 *  - Desktop (Electron): the binary auto-update feed (electron-updater) is the
 *    primary mechanism, but this endpoint gives a cheap, CDN-cacheable way to
 *    detect "a newer version exists" the moment connectivity returns.
 *
 * The value is the single source of truth from package.json, injected at build
 * time via next.config.ts (NEXT_PUBLIC_APP_VERSION).
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      version: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0",
      // Bump this if a release requires a hard client refresh (schema-breaking
      // shell change). PWAs can compare and force-reload when it increases.
      minClientVersion: process.env.NEXT_PUBLIC_MIN_CLIENT_VERSION ?? null,
      builtAt: process.env.NEXT_PUBLIC_BUILD_TIME ?? null,
      // Distinct from data-sync protocol version. Offline writes are not
      // versioned here — they live in SQLite / IndexedDB and survive updates.
      channel: "latest",
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}

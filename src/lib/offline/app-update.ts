/**
 * App-version updates (code / installer) — separate from data sync.
 *
 * PowerSync / the IndexedDB outbox / SQLite ledger handle business data.
 * This module only answers: "is a newer *app shell* available?"
 *
 *  - PWA: compare the running build to GET /api/app-version, then activate
 *    a waiting service worker (skipWaiting + clients.claim) on the next
 *    refresh. IndexedDB is origin-scoped and survives the reload.
 *  - Desktop: electron-updater talks to the published feed. The local
 *    SQLite file lives in userData (outside the install dir), so an NSIS
 *    in-place upgrade never touches unsynced writes.
 */

import { listAllPendingMutations } from "@/lib/offline/local-db";
import { isElectronRuntime } from "@/lib/offline/service-worker";

export type PublishedVersion = {
  version: string;
  minClientVersion?: string | null;
  builtAt?: string | null;
};

export type DesktopUpdaterEvent = {
  status:
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "up-to-date"
    | "error";
  version?: string;
  percent?: number;
  pendingUnsynced?: number;
  message?: string;
  releaseNotes?: string | null;
};

export type DesktopUpdaterApi = {
  isDesktop?: boolean;
  appVersion?: () => Promise<string>;
  checkForUpdates?: () => Promise<{ ok: boolean; error?: string }>;
  applyUpdate?: () => Promise<{ ok: boolean; error?: string }>;
  updaterState?: () => Promise<{
    configured?: boolean;
    downloaded?: boolean;
    version?: string | null;
    pendingUnsynced?: number;
  }>;
  onUpdaterEvent?: (cb: (payload: DesktopUpdaterEvent) => void) => () => void;
};

export function getDesktopUpdater(): DesktopUpdaterApi | null {
  if (typeof window === "undefined") return null;
  const api = window.umarDesktop as DesktopUpdaterApi | undefined;
  if (!api?.isDesktop) return null;
  return api;
}

export function getRunningAppVersion() {
  return process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
}

export function getRunningBuildTime() {
  return process.env.NEXT_PUBLIC_BUILD_TIME ?? null;
}

/** Compare dotted versions. Returns 1 if a > b, -1 if a < b, 0 if equal. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function parseSemver(value: string): [number, number, number] {
  const clean = String(value || "0")
    .replace(/^v/i, "")
    .split(/[+-]/)[0];
  const parts = clean.split(".").map((n) => Number.parseInt(n, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function versionCheckUrl() {
  return process.env.NEXT_PUBLIC_UPDATE_CHECK_URL || "/api/app-version";
}

/**
 * Cheap version probe against the published (online) app.
 *
 * For a shop Electron build this hits the *local* Next server unless
 * NEXT_PUBLIC_UPDATE_CHECK_URL points at the cloud deploy — the binary
 * feed (electron-updater) is still the thing that downloads the installer.
 * For a PWA this is the signal that a newer shell was deployed.
 */
export async function fetchPublishedVersion(): Promise<PublishedVersion | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(versionCheckUrl(), {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PublishedVersion;
    if (!data?.version) return null;
    return data;
  } catch {
    return null;
  }
}

export function isPublishedNewer(
  remote: PublishedVersion,
  localVersion = getRunningAppVersion(),
  localBuiltAt = getRunningBuildTime(),
) {
  if (compareSemver(remote.version, localVersion) > 0) return true;
  if (
    remote.minClientVersion &&
    compareSemver(remote.minClientVersion, localVersion) > 0
  ) {
    return true;
  }
  // Same semver, newer deploy (PWA only — Electron ignores builtAt).
  if (
    !isElectronRuntime() &&
    remote.builtAt &&
    localBuiltAt &&
    remote.builtAt > localBuiltAt
  ) {
    return true;
  }
  return false;
}

export function isUpdateRequired(
  remote: PublishedVersion,
  localVersion = getRunningAppVersion(),
) {
  return Boolean(
    remote.minClientVersion &&
      compareSemver(remote.minClientVersion, localVersion) > 0,
  );
}

/** Pending offline writes that must survive an app-shell update. */
export async function countUnsyncedWrites() {
  try {
    const rows = await listAllPendingMutations();
    return rows.length;
  } catch {
    return 0;
  }
}

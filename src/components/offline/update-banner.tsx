"use client";

import { Button } from "@/components/ui/button";
import { useAppUpdate } from "@/hooks/use-app-update";
import { Download, Loader2, RefreshCw, X } from "lucide-react";

/**
 * Global prompt for app-shell updates (Electron installer or PWA worker).
 * Mounted in the root layout so it works on login / company-pick as well.
 *
 * Applying an update never wipes the local ledger: SQLite lives in userData
 * and IndexedDB/outbox mutations survive a reload. We still surface the
 * unsynced count so the operator can sync first if they want.
 */
export function AppUpdateBanner() {
  const { state, applying, apply, dismiss } = useAppUpdate();

  if (state.status === "idle" || state.status === "error") return null;
  if (state.status === "checking") return null;

  const versionLabel = state.availableVersion
    ? ` ${state.availableVersion}`
    : "";

  const copy =
    state.status === "downloading"
      ? `Downloading update${versionLabel}… ${state.percent}%`
      : state.status === "available"
        ? `A newer version${versionLabel} is available. It will download in the background.`
        : state.source === "desktop"
          ? `Update${versionLabel} is ready. Restart to apply — unsynced records stay on this PC.`
          : `A new version${versionLabel} is ready. Reload to apply — your offline queue is kept.`;

  const showApply = state.status === "ready";
  const pendingNote =
    state.pendingUnsynced > 0
      ? `${state.pendingUnsynced} unsynced record${state.pendingUnsynced === 1 ? "" : "s"} will be kept.`
      : null;

  return (
    <div
      role="status"
      className="sticky top-0 z-[60] flex items-center gap-3 border-b border-[var(--brand-soft)] bg-[var(--brand-soft)] px-3 py-2 text-sm text-[var(--brand-strong)] sm:px-4"
    >
      {state.status === "downloading" ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      ) : (
        <Download className="h-4 w-4 shrink-0" />
      )}
      <p className="min-w-0 flex-1">
        {copy}
        {pendingNote ? (
          <span className="ml-1 opacity-80">{pendingNote}</span>
        ) : null}
      </p>
      {showApply ? (
        <Button
          size="sm"
          onClick={() => void apply()}
          disabled={applying}
        >
          {applying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {state.source === "desktop" ? "Restart & update" : "Reload"}
        </Button>
      ) : null}
      {!state.required ? (
        <button
          type="button"
          onClick={dismiss}
          className="rounded p-1 hover:bg-white/60"
          aria-label="Dismiss update notice"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

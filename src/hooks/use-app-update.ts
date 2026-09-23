"use client";

import {
  countUnsyncedWrites,
  fetchPublishedVersion,
  getDesktopUpdater,
  getRunningAppVersion,
  isPublishedNewer,
  isUpdateRequired,
  type DesktopUpdaterEvent,
} from "@/lib/offline/app-update";
import {
  applyPwaUpdate,
  checkForPwaUpdate,
  onPwaUpdateReady,
  setupServiceWorker,
} from "@/lib/offline/service-worker";
import { useCallback, useEffect, useState } from "react";

export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export type AppUpdateState = {
  status: AppUpdateStatus;
  source: "desktop" | "pwa" | null;
  currentVersion: string;
  availableVersion: string | null;
  percent: number;
  pendingUnsynced: number;
  required: boolean;
  message: string | null;
};

const INITIAL: AppUpdateState = {
  status: "idle",
  source: null,
  currentVersion: getRunningAppVersion(),
  availableVersion: null,
  percent: 0,
  pendingUnsynced: 0,
  required: false,
  message: null,
};

function dismissKey(version: string) {
  return `umar-update-dismissed:${version}`;
}

function wasDismissed(version: string) {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(dismissKey(version)) === "1";
  } catch {
    return false;
  }
}

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState>(INITIAL);
  const [applying, setApplying] = useState(false);

  const refreshPending = useCallback(async () => {
    const pending = await countUnsyncedWrites();
    setState((prev) => ({ ...prev, pendingUnsynced: pending }));
    return pending;
  }, []);

  const checkNow = useCallback(async () => {
    const desktop = getDesktopUpdater();
    if (desktop?.checkForUpdates) {
      setState((prev) => ({ ...prev, status: "checking", source: "desktop" }));
      try {
        await desktop.checkForUpdates();
      } catch {
        /* electron-updater emits its own error event */
      }
    }

    await checkForPwaUpdate();

    const remote = await fetchPublishedVersion();
    if (!remote) return;

    const newer = isPublishedNewer(remote);
    const required = isUpdateRequired(remote);
    if (!newer) {
      setState((prev) =>
        prev.status === "checking" && prev.source !== "desktop"
          ? { ...prev, status: "idle" }
          : prev,
      );
      return;
    }

    if (!required && wasDismissed(remote.version)) return;

    setState((prev) => {
      // Desktop download/ready events win over a mere version-probe.
      if (prev.source === "desktop" && (prev.status === "downloading" || prev.status === "ready")) {
        return { ...prev, required: required || prev.required, availableVersion: remote.version };
      }
      return {
        ...prev,
        status: prev.status === "ready" ? "ready" : "available",
        source: prev.source ?? (desktop ? "desktop" : "pwa"),
        availableVersion: remote.version,
        required,
      };
    });
  }, []);

  const apply = useCallback(async () => {
    setApplying(true);
    const pending = await refreshPending();
    const desktop = getDesktopUpdater();
    if (desktop?.applyUpdate && state.source === "desktop") {
      const result = await desktop.applyUpdate();
      if (!result?.ok) {
        setApplying(false);
        setState((prev) => ({
          ...prev,
          status: "error",
          message: result?.error || "Could not apply the update.",
        }));
      }
      return pending;
    }
    applyPwaUpdate();
    window.setTimeout(() => {
      window.location.reload();
    }, 250);
    return pending;
  }, [refreshPending, state.source]);

  const dismiss = useCallback(() => {
    const version = state.availableVersion || state.currentVersion;
    try {
      sessionStorage.setItem(dismissKey(version), "1");
    } catch {
      /* ignore */
    }
    setState((prev) => ({ ...prev, status: "idle", message: null }));
  }, [state.availableVersion, state.currentVersion]);

  useEffect(() => {
    void setupServiceWorker();
    const desktop = getDesktopUpdater();

    if (desktop?.appVersion) {
      void desktop.appVersion().then((version) => {
        if (version) {
          setState((prev) => ({ ...prev, currentVersion: version }));
        }
      });
    }

    if (desktop?.updaterState) {
      void desktop.updaterState().then((s) => {
        if (s?.downloaded) {
          setState((prev) => ({
            ...prev,
            status: "ready",
            source: "desktop",
            availableVersion: s.version || prev.availableVersion,
            pendingUnsynced: Number(s.pendingUnsynced || 0),
          }));
        }
      });
    }

    const unsubDesktop = desktop?.onUpdaterEvent?.((event: DesktopUpdaterEvent) => {
      setState((prev) => {
        const version = event.version || prev.availableVersion;
        if (event.status === "checking") {
          return { ...prev, status: "checking", source: "desktop", message: null };
        }
        if (event.status === "available") {
          if (version && !isUpdateRequired({ version, minClientVersion: null }) && wasDismissed(version)) {
            return { ...prev, source: "desktop", availableVersion: version };
          }
          return {
            ...prev,
            status: "available",
            source: "desktop",
            availableVersion: version,
            message: null,
          };
        }
        if (event.status === "downloading") {
          return {
            ...prev,
            status: "downloading",
            source: "desktop",
            availableVersion: version,
            percent: event.percent ?? prev.percent,
            message: null,
          };
        }
        if (event.status === "downloaded") {
          return {
            ...prev,
            status: "ready",
            source: "desktop",
            availableVersion: version,
            percent: 100,
            pendingUnsynced: Number(event.pendingUnsynced ?? prev.pendingUnsynced),
            message: null,
          };
        }
        if (event.status === "up-to-date") {
          return prev.status === "ready" || prev.status === "available"
            ? prev
            : { ...prev, status: "idle", source: "desktop", message: null };
        }
        if (event.status === "error") {
          return { ...prev, status: "error", message: event.message || "Update check failed" };
        }
        return prev;
      });
    });

    const unsubPwa = onPwaUpdateReady((ready) => {
      if (!ready) return;
      void countUnsyncedWrites().then((pending) => {
        setState((prev) => {
          if (prev.source === "desktop" && (prev.status === "downloading" || prev.status === "ready")) {
            return prev;
          }
          return {
            ...prev,
            status: "ready",
            source: "pwa",
            pendingUnsynced: pending,
          };
        });
      });
    });

    const onOnline = () => {
      void checkNow();
    };
    window.addEventListener("online", onOnline);

    const startup = window.setTimeout(() => {
      if (typeof navigator === "undefined" || navigator.onLine) {
        void checkNow();
      }
    }, 4000);

    void refreshPending();

    return () => {
      unsubDesktop?.();
      unsubPwa();
      window.removeEventListener("online", onOnline);
      window.clearTimeout(startup);
    };
  }, [checkNow, refreshPending]);

  return { state, applying, checkNow, apply, dismiss, refreshPending };
}

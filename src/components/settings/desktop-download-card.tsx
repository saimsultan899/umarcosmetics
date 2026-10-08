"use client";

import { Button } from "@/components/ui/button";
import type { DesktopInstallerInfo } from "@/lib/desktop/update-feed";
import { isElectronRuntime } from "@/lib/offline/service-worker";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";

export function DesktopDownloadCard({ compact = false }: { compact?: boolean }) {
  const [info, setInfo] = useState<DesktopInstallerInfo | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setOffline(true);
      return;
    }
    void fetch("/api/desktop-update/info", { cache: "no-store" })
      .then((res) => res.json() as Promise<DesktopInstallerInfo>)
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setOffline(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onDesktop = isElectronRuntime();
  const versionLabel = info?.version ? ` ${info.version}` : "";

  return (
    <section className={compact ? "login-download" : "panel p-5"}>
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl">
          <img src="/icons/icon-192.png" alt="" className="h-full w-full object-cover" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className={compact ? "text-sm font-semibold" : "font-[family-name:var(--font-display)] text-lg font-semibold"}>
            Windows app
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {onDesktop
              ? "Use this if another computer needs the app, or this one was formatted and you are installing again."
              : "Install the app on a shop PC. It keeps working offline, and your books stay on that computer."}
            {info?.available ? ` Version${versionLabel} is ready.` : ""}
          </p>
        </div>
      </div>
      <div className="mt-4">
        {offline ? (
          <p className="text-sm text-[var(--muted)]">Connect to the internet to download the installer.</p>
        ) : info && !info.available ? (
          <p className="text-sm text-[var(--muted)]">
            The installer is not published yet. It will appear here after the next desktop release.
          </p>
        ) : (
          <Button
            variant={compact ? "secondary" : "primary"}
            className={compact ? "w-full" : undefined}
            disabled={info === null || !info.downloadUrl}
            onClick={() => {
              if (!info?.downloadUrl) return;
              window.open(info.downloadUrl, "_blank", "noopener,noreferrer");
            }}
          >
            <Download className="h-4 w-4" />
            {info === null ? "Checking installer…" : `Download Windows app${versionLabel}`}
          </Button>
        )}
      </div>
    </section>
  );
}

"use client";

import { HeaderClock } from "@/components/layout/header-clock";
import { AlertsMenu } from "@/components/layout/alerts-menu";
import { useSyncStatus } from "@/components/offline/sync-provider";
import { CommandPalette } from "@/components/search/command-palette";
import { Button } from "@/components/ui/button";
import {
  clearOfflineShellCookie,
  readOfflineShellCookie,
  writeOfflineShellCookie,
} from "@/lib/offline/offline-shell";
import { setOfflineSessionCookie } from "@/lib/offline/local-auth";
import { createClient } from "@/lib/supabase/client";
import type { Company } from "@/lib/types/database";
import {
  Cloud,
  CloudOff,
  LogOut,
  Menu,
  RefreshCw,
} from "lucide-react";
import { useRouter } from "next/navigation";

export function Topbar({
  company,
  userName,
  onMenuClick,
}: {
  company?: Company | null;
  userName?: string | null;
  onMenuClick?: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const { online, pending, syncing, runSync } = useSyncStatus();

  async function signOut() {
    setOfflineSessionCookie(false);
    clearOfflineShellCookie();
    try {
      await supabase.auth.signOut();
    } catch {
      /* offline sign-out */
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 min-w-0 items-center justify-between gap-2 border-b border-[var(--border)] bg-white px-3 sm:h-16 sm:gap-3 sm:px-6">
      <div className="flex min-w-0 shrink items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          className="rounded-md p-2 text-[var(--ink)] hover:bg-[var(--surface-2)] lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <HeaderClock />
      </div>

      <div className="flex min-w-0 shrink-0 items-center gap-1 sm:gap-2 xl:gap-3">
        <CommandPalette companyId={company?.id} />
        <AlertsMenu companyId={company?.id} />

        <button
          type="button"
          onClick={() => void runSync()}
          className={`hidden items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-medium lg:flex ${
            online
              ? "border-[var(--brand-soft)] bg-[var(--brand-soft)] text-[var(--brand-strong)]"
              : "border-[var(--accent-soft)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
          }`}
          title={syncing ? "Syncing..." : online ? "Online" : "Offline"}
        >
          {syncing ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : online ? (
            <Cloud className="h-3.5 w-3.5" />
          ) : (
            <CloudOff className="h-3.5 w-3.5" />
          )}
          {syncing
            ? "Syncing..."
            : online
              ? pending.total > 0
                ? `${pending.total} pending`
                : "Online"
              : "Offline"}
        </button>

        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            if (online) {
              try {
                await supabase.rpc("clear_active_company");
              } catch {
                /* network blip — still open picker */
              }
            } else {
              const shell = readOfflineShellCookie();
              if (shell) {
                writeOfflineShellCookie({
                  ...shell,
                  activeCompanyId: null,
                  company: null,
                  savedAt: new Date().toISOString(),
                });
              }
              setOfflineSessionCookie(true);
            }
            router.push("/select-company");
            router.refresh();
          }}
          className="px-2 sm:px-3"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Switch company</span>
        </Button>
        <button
          type="button"
          title={userName || "User"}
          className="header-avatar"
          aria-label={userName ? `Signed in as ${userName}` : "Signed in user"}
        >
          {(userName || "U").trim().charAt(0).toUpperCase()}
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={signOut}
          aria-label="Log out"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}

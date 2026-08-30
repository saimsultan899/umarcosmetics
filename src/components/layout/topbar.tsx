"use client";

import { HeaderClock } from "@/components/layout/header-clock";
import { AlertsMenu } from "@/components/layout/alerts-menu";
import { useSyncStatus } from "@/components/offline/sync-provider";
import { CommandPalette } from "@/components/search/command-palette";
import { Button } from "@/components/ui/button";
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
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-[var(--border)] bg-white px-3 sm:h-16 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
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

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        <CommandPalette companyId={company?.id} />
        <AlertsMenu companyId={company?.id} />

        <button
          type="button"
          onClick={() => void runSync()}
          className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium sm:flex ${
            online
              ? "border-[var(--brand-soft)] bg-[var(--brand-soft)] text-[var(--brand-strong)]"
              : "border-[var(--accent-soft)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
          }`}
          title={syncing ? "Syncing..." : "Sync offline queue"}
        >
          {online ? (
            <Cloud className="h-3.5 w-3.5" />
          ) : (
            <CloudOff className="h-3.5 w-3.5" />
          )}
          {syncing
            ? "Syncing..."
            : online
              ? pending
                ? `${pending} pending`
                : "Online"
              : "Offline"}
        </button>

        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            await supabase.rpc("clear_active_company");
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

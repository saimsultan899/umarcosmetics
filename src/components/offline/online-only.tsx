"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import { Button } from "@/components/ui/button";
import { WifiOff } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Wraps admin / online-only actions. When offline, shows a clear block message.
 */
export function OnlineOnly({
  children,
  title = "Internet required",
  description = "This action needs a cloud connection (user invites, org setup, etc.).",
}: {
  children?: ReactNode;
  title?: string;
  description?: string;
}) {
  const { online } = useSyncStatus();
  if (online) return <>{children}</>;

  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <WifiOff className="h-6 w-6 text-[var(--muted)]" />
      <div>
        <h2 className="text-base font-semibold text-[var(--ink)]">{title}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>
      </div>
      <Button type="button" disabled variant="secondary">
        Unavailable offline
      </Button>
    </div>
  );
}

export function useRequireOnline(): boolean {
  const { online } = useSyncStatus();
  return online;
}

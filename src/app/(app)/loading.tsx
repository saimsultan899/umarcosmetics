"use client";

import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useSyncStatus } from "@/components/offline/sync-provider";

/**
 * Generic loading state. Do not force dashboard UI on every route.
 */
export default function AppLoading() {
  const { online } = useSyncStatus();
  return (
    <div className="space-y-3">
      {!online ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Offline — loading local ledger…
        </p>
      ) : null}
      <PageSkeleton />
    </div>
  );
}

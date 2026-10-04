"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import { RecoveriesTable } from "@/components/tables/recoveries-table";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useRecoveryList } from "@/hooks/use-recovery-list";
import type { RecoveryListResult } from "@/lib/queries/recoveries";
import type { Company } from "@/lib/types/database";
import Link from "next/link";

export function RecoveriesView({
  company,
  initialData,
  initialOffline = false,
}: {
  company: Company;
  initialData?: RecoveryListResult | null;
  initialOffline?: boolean;
}) {
  const sync = useSyncStatus();
  const isOnline = sync ? sync.online : !initialOffline;
  const {
    rows,
    pagination,
    cityOptions,
    sectorOptions,
    salesmanOptions,
    loading,
    refetch,
  } = useRecoveryList({
    companyId: company.id,
    initialData,
    initialOffline,
  });

  if (loading && !rows.length) return <PageSkeleton />;

  return (
    <div className="animate-rise space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Field recoveries
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Collections synced from salesman / office recovery entry. Use the
            undo icon on a row to cancel / fix a mistaken collection.
          </p>
        </div>
        <Link
          href="/sales/salesmen"
          className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)]"
        >
          Salesman-wise report →
        </Link>
      </div>

      <RecoveriesTable
        rows={rows}
        pagination={pagination}
        cityOptions={cityOptions}
        sectorOptions={sectorOptions}
        salesmanOptions={salesmanOptions}
        canCancel={Boolean(isOnline)}
        onChanged={() => void refetch()}
      />
    </div>
  );
}

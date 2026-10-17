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
    headOptions,
    salesmanOptions,
    amountTotal,
    remainingTotal,
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
            Recovery history
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
            Complete collection record from field recovery and cash receipt.
            Filter by date, sector, city, head, or salesman. Search a customer,
            then view / edit / delete any entry.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/reports/recovery"
            className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)]"
          >
            Customer receivables →
          </Link>
          <Link
            href="/vouchers/cash-receipt"
            className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)]"
          >
            Cash receipt →
          </Link>
        </div>
      </div>

      <RecoveriesTable
        companyId={company.id}
        rows={rows}
        pagination={pagination}
        cityOptions={cityOptions}
        sectorOptions={sectorOptions}
        headOptions={headOptions}
        salesmanOptions={salesmanOptions}
        amountTotal={amountTotal}
        remainingTotal={remainingTotal}
        canCancel={Boolean(isOnline)}
        onChanged={() => void refetch()}
      />
    </div>
  );
}

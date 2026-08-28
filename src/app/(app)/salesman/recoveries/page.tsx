import { RecoveriesTable } from "@/components/tables/recoveries-table";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { requireCompanyContext } from "@/lib/auth";
import { fetchRecoveryList } from "@/lib/queries/recoveries";
import Link from "next/link";
import { Suspense } from "react";

export default async function SalesmanRecoveriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();
  const list = await fetchRecoveryList(supabase, company.id, sp);

  return (
    <div className="animate-rise space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Field recoveries
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Collections synced from salesman / office recovery entry
          </p>
        </div>
        <Link
          href="/sales/salesmen"
          className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)]"
        >
          Salesman-wise report →
        </Link>
      </div>
      <Suspense fallback={<PageSkeleton />}>
        <RecoveriesTable
          rows={list.rows}
          pagination={list.pagination}
          cityOptions={list.cityOptions}
          sectorOptions={list.sectorOptions}
          salesmanOptions={list.salesmanOptions}
        />
      </Suspense>
    </div>
  );
}

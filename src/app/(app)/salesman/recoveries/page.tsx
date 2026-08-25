import { RecoveriesTable } from "@/components/tables/recoveries-table";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { requireCompanyContext } from "@/lib/auth";
import { fetchRecoveryList } from "@/lib/queries/recoveries";
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
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          Field recoveries
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Collections synced from salesman / office recovery entry
        </p>
      </div>
      <Suspense fallback={<PageSkeleton />}>
        <RecoveriesTable
          rows={list.rows}
          pagination={list.pagination}
          cityOptions={list.cityOptions}
          sectorOptions={list.sectorOptions}
        />
      </Suspense>
    </div>
  );
}

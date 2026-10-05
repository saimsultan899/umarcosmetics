import { GatePassesView } from "@/components/inventory/gate-passes-view";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { requireCompanyContext } from "@/lib/auth";
import { fetchGatePassList, type GatePassListResult } from "@/lib/queries/gate-passes";
import type { Warehouse } from "@/lib/types/database";
import { Suspense } from "react";

export default async function GatePassesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { company, supabase, offline } = await requireCompanyContext();

  let initialData: GatePassListResult | null = null;
  let warehouses: Warehouse[] = [];
  if (!offline) {
    try {
      const [list, warehouseRes] = await Promise.all([
        fetchGatePassList(supabase, company.id, sp),
        supabase
          .from("warehouses")
          .select("*")
          .eq("company_id", company.id)
          .eq("is_active", true)
          .order("name"),
      ]);
      initialData = list;
      warehouses = (warehouseRes.data || []) as Warehouse[];
    } catch {
      initialData = null;
    }
  }

  return (
    <Suspense fallback={<PageSkeleton />}>
      <GatePassesView
        company={company}
        initialData={initialData}
        initialWarehouses={warehouses}
        initialOffline={offline}
      />
    </Suspense>
  );
}

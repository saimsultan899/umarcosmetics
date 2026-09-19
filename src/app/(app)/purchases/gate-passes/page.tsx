import { GatePassesView } from "@/components/inventory/gate-passes-view";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { fetchGatePassList, type GatePassListResult } from "@/lib/queries/gate-passes";
import { loadTradingMasters } from "@/lib/trading-data";
import { Suspense } from "react";

export default async function GatePassesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { company, parties, products, warehouses, supabase, offline } =
    await loadTradingMasters();

  let initialData: GatePassListResult | null = null;
  if (!offline) {
    try {
      initialData = await fetchGatePassList(supabase, company.id, sp);
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
        initialParties={parties}
        initialProducts={products}
        initialOffline={offline}
      />
    </Suspense>
  );
}

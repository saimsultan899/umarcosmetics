import { StockTransfersView } from "@/components/inventory/stock-transfers-view";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { fetchStockTransferList, type StockTransferListResult } from "@/lib/queries/stock-transfers";
import { loadTradingMasters } from "@/lib/trading-data";
import { Suspense } from "react";

export default async function StockTransfersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { company, products, warehouses, supabase, offline } =
    await loadTradingMasters();

  let initialData: StockTransferListResult | null = null;
  if (!offline) {
    try {
      initialData = await fetchStockTransferList(supabase, company.id, sp);
    } catch {
      initialData = null;
    }
  }

  return (
    <Suspense fallback={<PageSkeleton />}>
      <StockTransfersView
        company={company}
        initialData={initialData}
        initialWarehouses={warehouses}
        initialProducts={products}
        initialOffline={offline}
      />
    </Suspense>
  );
}

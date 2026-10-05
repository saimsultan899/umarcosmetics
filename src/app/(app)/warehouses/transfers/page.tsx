import { StockTransfersView } from "@/components/inventory/stock-transfers-view";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { requireCompanyContext } from "@/lib/auth";
import { fetchStockTransferList, type StockTransferListResult } from "@/lib/queries/stock-transfers";
import type { Warehouse } from "@/lib/types/database";
import { Suspense } from "react";

export default async function StockTransfersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { company, supabase, offline } = await requireCompanyContext();

  let initialData: StockTransferListResult | null = null;
  let warehouses: Warehouse[] = [];
  if (!offline) {
    try {
      const [list, warehouseRes] = await Promise.all([
        fetchStockTransferList(supabase, company.id, sp),
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
      <StockTransfersView
        company={company}
        initialData={initialData}
        initialWarehouses={warehouses}
        initialOffline={offline}
      />
    </Suspense>
  );
}

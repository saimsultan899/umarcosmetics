import { LoadSheetsView } from "@/components/inventory/load-sheets-view";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { requireCompanyContext } from "@/lib/auth";
import { fetchLoadSheetList, type LoadSheetListResult } from "@/lib/queries/load-sheets";
import { fetchCompanySalesmen, type SalesmanOption } from "@/lib/queries/salesmen";
import type { Warehouse } from "@/lib/types/database";
import { Suspense } from "react";

export default async function LoadSheetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, company, offline } = await requireCompanyContext();

  let initialData: LoadSheetListResult | null = null;
  let initialWarehouses: Warehouse[] = [];
  let initialSalesmen: SalesmanOption[] = [];

  if (!offline) {
    try {
      const [{ data: warehouses }, salesmen, list] = await Promise.all([
        supabase
          .from("warehouses")
          .select("*")
          .eq("company_id", company.id)
          .eq("is_active", true)
          .order("name"),
        fetchCompanySalesmen(supabase, company.id),
        fetchLoadSheetList(supabase, company.id, sp),
      ]);
      initialWarehouses = (warehouses as Warehouse[]) || [];
      initialSalesmen = salesmen;
      initialData = list;
    } catch {
      initialData = null;
    }
  }

  return (
    <Suspense fallback={<PageSkeleton />}>
      <LoadSheetsView
        company={company}
        initialData={initialData}
        initialWarehouses={initialWarehouses}
        initialSalesmen={initialSalesmen}
        initialOffline={offline}
      />
    </Suspense>
  );
}

import { ReturnsView } from "@/components/trading/returns-view";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { requireCompanyContext } from "@/lib/auth";
import {
  documentListConfigs,
  fetchDocumentList,
  type DocumentListRow,
  type DocumentListSummary,
} from "@/lib/queries/documents";
import type { PaginationMeta } from "@/lib/pagination";
import type { Warehouse } from "@/lib/types/database";
import { Suspense } from "react";

type ReturnListResult = {
  rows: DocumentListRow[];
  pagination: PaginationMeta;
  summary: DocumentListSummary;
};

export default async function PurchaseReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { company, supabase, offline } = await requireCompanyContext();

  let initialData: ReturnListResult | null = null;
  let warehouses: Warehouse[] = [];
  if (!offline) {
    try {
      const [list, warehouseRes] = await Promise.all([
        fetchDocumentList(
          supabase,
          company.id,
          sp,
          documentListConfigs.purchaseReturn,
        ),
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
      <ReturnsView
        company={company}
        kind="purchase"
        initialData={initialData}
        initialWarehouses={warehouses}
        initialOffline={offline}
      />
    </Suspense>
  );
}

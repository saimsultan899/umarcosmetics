import { ReturnsView } from "@/components/trading/returns-view";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { loadTradingMasters } from "@/lib/trading-data";
import {
  documentListConfigs,
  fetchDocumentList,
  type DocumentListRow,
  type DocumentListSummary,
} from "@/lib/queries/documents";
import type { PaginationMeta } from "@/lib/pagination";
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
  const { company, parties, products, warehouses, supabase, offline } =
    await loadTradingMasters();

  let initialData: ReturnListResult | null = null;
  if (!offline) {
    try {
      initialData = await fetchDocumentList(
        supabase,
        company.id,
        sp,
        documentListConfigs.purchaseReturn,
      );
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
        initialParties={parties}
        initialProducts={products}
        initialWarehouses={warehouses}
        initialOffline={offline}
      />
    </Suspense>
  );
}

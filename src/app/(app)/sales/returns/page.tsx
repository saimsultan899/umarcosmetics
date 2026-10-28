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
import { pickEditedDocuments, type EditedSaleRef } from "@/lib/trading/edited-sales";
import { Suspense } from "react";

type ReturnListResult = {
  rows: DocumentListRow[];
  pagination: PaginationMeta;
  summary: DocumentListSummary;
};

export default async function SaleReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { company, supabase, offline } = await requireCompanyContext();

  let initialData: ReturnListResult | null = null;
  let warehouses: Warehouse[] = [];
  let initialEdited: EditedSaleRef[] = [];
  if (!offline) {
    try {
      const [list, warehouseRes, editedRes] = await Promise.all([
        fetchDocumentList(
          supabase,
          company.id,
          sp,
          documentListConfigs.saleReturn,
        ),
        supabase
          .from("warehouses")
          .select("*")
          .eq("company_id", company.id)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("sale_returns")
          .select(
            "id, return_no, return_date, grand_total, created_at, updated_at, status, parties(party_code, name_en)",
          )
          .eq("company_id", company.id)
          .order("updated_at", { ascending: false })
          .limit(40),
      ]);
      initialData = list;
      warehouses = (warehouseRes.data || []) as Warehouse[];
      initialEdited = pickEditedDocuments(editedRes.data || [], {
        hrefPrefix: "/sales/returns",
        noField: "return_no",
        dateField: "return_date",
      });
    } catch {
      initialData = null;
    }
  }

  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReturnsView
        company={company}
        kind="sale"
        initialData={initialData}
        initialWarehouses={warehouses}
        initialEdited={initialEdited}
        initialOffline={offline}
      />
    </Suspense>
  );
}

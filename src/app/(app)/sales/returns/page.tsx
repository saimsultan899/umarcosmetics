import { DocumentListTable } from "@/components/tables/document-list-table";
import { ReturnForm } from "@/components/trading/return-form";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { loadTradingMasters } from "@/lib/trading-data";
import {
  documentListConfigs,
  fetchDocumentList,
} from "@/lib/queries/documents";
import { Suspense } from "react";

export default async function SaleReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { company, parties, products, warehouses, supabase } =
    await loadTradingMasters();

  const list = await fetchDocumentList(
    supabase,
    company.id,
    sp,
    documentListConfigs.saleReturn,
  );

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Sale Return"
        description="Receive returned goods and restore stock"
        actions={
          <CreateDialogButton
            label="New return"
            title="New sale return"
            description="Restore stock from a customer return"
            size="xl"
          >
            <ReturnForm
              kind="sale"
              companyId={company.id}
              organizationId={company.organization_id}
              parties={parties}
              products={products}
              warehouses={warehouses}
            />
          </CreateDialogButton>
        }
      />

      <Suspense fallback={<PageSkeleton />}>
        <DocumentListTable
          title="Sale returns"
          rows={list.rows}
          pagination={list.pagination}
          summary={list.summary}
          warehouses={warehouses}
        />
      </Suspense>
    </div>
  );
}

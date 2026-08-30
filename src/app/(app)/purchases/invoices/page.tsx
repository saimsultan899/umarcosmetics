import { DocumentListTable } from "@/components/tables/document-list-table";
import { PurchaseInvoiceForm } from "@/components/trading/purchase-invoice-form";
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

export default async function PurchaseInvoicesPage({
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
    documentListConfigs.purchase,
  );

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Purchase Invoice"
        description="Receive stock from vendors into a company."
        actions={
          <CreateDialogButton
            label="New purchase"
            title="New purchase invoice"
            description="Receive vendor stock into a company"
            size="xl"
          >
            <PurchaseInvoiceForm
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
          title="Purchase invoices"
          rows={list.rows}
          pagination={list.pagination}
          summary={list.summary}
          warehouses={warehouses}
          partyColumnLabel="Vendor"
        />
      </Suspense>
    </div>
  );
}

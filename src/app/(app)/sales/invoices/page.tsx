import { DocumentListTable } from "@/components/tables/document-list-table";
import { SaleInvoiceForm } from "@/components/trading/sale-invoice-form";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { loadTradingMasters } from "@/lib/trading-data";
import { fetchCompanySalesmen } from "@/lib/queries/salesmen";
import {
  documentListConfigs,
  fetchDocumentList,
} from "@/lib/queries/documents";
import { Suspense } from "react";

export default async function SaleInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { company, parties, products, warehouses, supabase } =
    await loadTradingMasters();

  const [{ data: stockRows }, list, salesmen] = await Promise.all([
    supabase
      .from("stock_balances")
      .select("product_id, warehouse_id, qty")
      .eq("company_id", company.id)
      .gt("qty", 0),
    fetchDocumentList(
      supabase,
      company.id,
      sp,
      documentListConfigs.sale,
      { showPaymentFilter: true },
    ),
    fetchCompanySalesmen(supabase, company.id),
  ]);

  const canCreate =
    parties.length > 0 && products.length > 0 && warehouses.length > 0;

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Sale Invoice"
        description="Post counter / credit sales and deduct stock."
        actions={
          <CreateDialogButton
            label="New sale"
            title="New sale invoice"
            description="Post a sale and deduct warehouse stock"
            size="xl"
            disabled={!canCreate}
            disabledHint="Add at least one party, product, and warehouse first."
          >
            <SaleInvoiceForm
              companyId={company.id}
              organizationId={company.organization_id}
              parties={parties}
              products={products}
              warehouses={warehouses}
              stockBalances={stockRows || []}
              salesmen={salesmen}
            />
          </CreateDialogButton>
        }
      />

      <Suspense fallback={<PageSkeleton />}>
        <DocumentListTable
          title="Sale invoices"
          rows={list.rows}
          pagination={list.pagination}
          summary={list.summary}
          showPaymentFilter
          warehouses={warehouses}
        />
      </Suspense>
    </div>
  );
}

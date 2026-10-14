import { OfflineTradingListPage } from "@/components/offline/offline-trading-list";
import {
  SaleInvoiceCreateButton,
} from "@/components/trading/lazy-invoice-create";
import { SaleInvoicesListWithPending } from "@/components/trading/sale-invoices-list-with-pending";
import { PageHeading } from "@/components/ui/create-dialog";
import { requireCompanyContext } from "@/lib/auth";
import {
  documentListConfigs,
  fetchDocumentList,
} from "@/lib/queries/documents";

export default async function SaleInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { company, supabase, offline } = await requireCompanyContext();

  if (offline) {
    return (
      <OfflineTradingListPage
        kind="sale"
        companyId={company.id}
        organizationId={company.organization_id}
      />
    );
  }

  const [{ data: warehouses }, list] = await Promise.all([
    supabase
      .from("warehouses")
      .select("id, name")
      .eq("company_id", company.id)
      .eq("is_active", true)
      .order("name"),
    fetchDocumentList(
      supabase,
      company.id,
      sp,
      documentListConfigs.sale,
      { showPaymentFilter: true },
    ),
  ]);

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Sale Invoice"
        description="Post counter / credit sales and deduct stock."
        actions={<SaleInvoiceCreateButton company={company} />}
      />

      <SaleInvoicesListWithPending
        companyId={company.id}
        serverRows={list.rows}
        pagination={list.pagination}
        summary={list.summary}
        warehouses={warehouses || []}
      />
    </div>
  );
}

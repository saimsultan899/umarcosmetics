import { DocumentListTable } from "@/components/tables/document-list-table";
import { OfflineTradingListPage } from "@/components/offline/offline-trading-list";
import { PurchaseInvoiceCreateButton } from "@/components/trading/lazy-invoice-create";
import { PageHeading } from "@/components/ui/create-dialog";
import { requireCompanyContext } from "@/lib/auth";
import {
  documentListConfigs,
  fetchDocumentList,
} from "@/lib/queries/documents";

export default async function PurchaseInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { company, supabase, offline } = await requireCompanyContext();

  if (offline) {
    return (
      <OfflineTradingListPage
        kind="purchase"
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
    fetchDocumentList(supabase, company.id, sp, documentListConfigs.purchase),
  ]);

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Purchase Invoice"
        description="Receive stock from vendors into a company."
        actions={<PurchaseInvoiceCreateButton company={company} />}
      />

      <DocumentListTable
        title="Purchase invoices"
        rows={list.rows}
        pagination={list.pagination}
        summary={list.summary}
        warehouses={warehouses || []}
        partyColumnLabel="Vendor"
        showPrint
      />
    </div>
  );
}

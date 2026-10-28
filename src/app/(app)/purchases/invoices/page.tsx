import { DocumentListTable } from "@/components/tables/document-list-table";
import { OfflineTradingListPage } from "@/components/offline/offline-trading-list";
import { PurchaseInvoiceCreateButton } from "@/components/trading/lazy-invoice-create";
import { PageHeading } from "@/components/ui/create-dialog";
import { requireCompanyContext } from "@/lib/auth";
import {
  documentListConfigs,
  fetchDocumentList,
} from "@/lib/queries/documents";
import { pickEditedDocuments } from "@/lib/trading/edited-sales";

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

  const [{ data: warehouses }, { data: editedRows }, list] = await Promise.all([
    supabase
      .from("warehouses")
      .select("id, name")
      .eq("company_id", company.id)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("purchase_invoices")
      .select(
        "id, invoice_no, invoice_date, grand_total, created_at, updated_at, status, parties(party_code, name_en)",
      )
      .eq("company_id", company.id)
      .order("updated_at", { ascending: false })
      .limit(40),
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
        showDateFilter
        showPurchaseColumns
        enableExport
        exportFilename="purchase-invoices"
        exportConfigKey="purchase"
        companyId={company.id}
        editedSales={pickEditedDocuments(editedRows || [], {
          hrefPrefix: "/purchases/invoices",
        })}
      />
    </div>
  );
}

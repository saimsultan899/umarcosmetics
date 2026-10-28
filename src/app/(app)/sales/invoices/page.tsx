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
import { pickEditedSales } from "@/lib/trading/edited-sales";

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

  const [{ data: warehouses }, { data: sectorRows }, { data: editedRows }, list] =
    await Promise.all([
    supabase
      .from("warehouses")
      .select("id, name")
      .eq("company_id", company.id)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("parties")
      .select("route")
      .eq("company_id", company.id)
      .eq("is_active", true)
      .in("party_subtype", ["customer", "both"])
      .not("route", "is", null)
      .limit(20000),
    supabase
      .from("sale_invoices")
      .select(
        "id, invoice_no, invoice_date, grand_total, created_at, updated_at, status, parties(party_code, name_en)",
      )
      .eq("company_id", company.id)
      .order("updated_at", { ascending: false })
      .limit(40),
    fetchDocumentList(
      supabase,
      company.id,
      sp,
      documentListConfigs.sale,
      { showPaymentFilter: true },
    ),
  ]);

  const sectors = Array.from(
    new Set(
      (sectorRows || [])
        .map((r) => String(r.route || "").trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));

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
        sectors={sectors}
        editedSales={pickEditedSales(editedRows || [])}
      />
    </div>
  );
}

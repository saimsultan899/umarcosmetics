import { DocumentListTable } from "@/components/tables/document-list-table";
import { SaleInvoiceForm } from "@/components/trading/sale-invoice-form";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { loadTradingMasters } from "@/lib/trading-data";
import type { SaleInvoice } from "@/lib/types/trading";

export default async function SaleInvoicesPage() {
  const { company, parties, products, warehouses, supabase } =
    await loadTradingMasters();

  const [{ data: invoices }, { data: stockRows }] = await Promise.all([
    supabase
      .from("sale_invoices")
      .select("*, parties(name_en, party_code), warehouses(name)")
      .eq("company_id", company.id)
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("stock_balances")
      .select("product_id, warehouse_id, qty")
      .eq("company_id", company.id)
      .gt("qty", 0),
  ]);

  const rows = ((invoices as SaleInvoice[]) || []).map((inv) => ({
    id: inv.id,
    docNo: inv.invoice_no,
    date: inv.invoice_date,
    partyLabel: inv.parties
      ? `${inv.parties.party_code} — ${inv.parties.name_en}`
      : "—",
    warehouseLabel: inv.warehouses?.name || "—",
    paymentType: inv.payment_type,
    total: Number(inv.grand_total || 0),
    href: `/sales/invoices/${inv.id}`,
    table: "sale_invoices",
    linesTable: "sale_invoice_items",
    linesFk: "sale_invoice_id",
  }));

  const canCreate =
    parties.length > 0 && products.length > 0 && warehouses.length > 0;

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Sale Invoice"
        description={`Create credit sales and post stock out for ${company.name}.`}
        actions={
          <CreateDialogButton
            label="New sale"
            title="New sale invoice"
            description="Create a credit sale with item-wise bonus"
            size="xl"
            disabled={!canCreate}
            disabledHint="Add parties, products, and warehouses before creating invoices."
          >
              <SaleInvoiceForm
                companyId={company.id}
                organizationId={company.organization_id}
                parties={parties}
                products={products}
                warehouses={warehouses}
                stockBalances={
                  (stockRows as {
                    product_id: string;
                    warehouse_id: string;
                    qty: number;
                  }[]) || []
                }
              />
          </CreateDialogButton>
        }
      />

      <DocumentListTable title="Sale invoices" rows={rows} showPaymentFilter />
    </div>
  );
}

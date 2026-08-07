import { DocumentListTable } from "@/components/tables/document-list-table";
import { PurchaseInvoiceForm } from "@/components/trading/purchase-invoice-form";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { loadTradingMasters } from "@/lib/trading-data";

export default async function PurchaseInvoicesPage() {
  const { company, parties, products, warehouses, supabase } =
    await loadTradingMasters();

  const { data: invoices } = await supabase
    .from("purchase_invoices")
    .select("*, parties(name_en, party_code), warehouses(name)")
    .eq("company_id", company.id)
    .order("invoice_date", { ascending: false })
    .limit(500);

  const rows = (invoices || []).map((inv) => {
    const party = Array.isArray(inv.parties) ? inv.parties[0] : inv.parties;
    const wh = Array.isArray(inv.warehouses) ? inv.warehouses[0] : inv.warehouses;
    return {
      id: inv.id,
      docNo: inv.invoice_no,
      date: inv.invoice_date,
      partyLabel: party ? `${party.party_code} — ${party.name_en}` : "—",
      warehouseLabel: wh?.name || "—",
      total: Number(inv.grand_total || 0),
      href: `/purchases/invoices/${inv.id}`,
      table: "purchase_invoices",
      linesTable: "purchase_invoice_items",
      linesFk: "purchase_invoice_id",
      extraFields: [
        { label: "Supplier bill #", value: inv.supplier_bill_no || "—" },
      ],
    };
  });

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Purchase Invoice"
        description="Receive stock from suppliers into warehouse."
        actions={
          <CreateDialogButton
            label="New purchase"
            title="New purchase invoice"
            description="Receive supplier stock into a warehouse"
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

      <DocumentListTable title="Purchase invoices" rows={rows} />
    </div>
  );
}

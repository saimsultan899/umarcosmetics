import { DocumentListTable } from "@/components/tables/document-list-table";
import { ReturnForm } from "@/components/trading/return-form";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { loadTradingMasters } from "@/lib/trading-data";

export default async function SaleReturnsPage() {
  const { company, parties, products, warehouses, supabase } =
    await loadTradingMasters();

  const { data: returns } = await supabase
    .from("sale_returns")
    .select("*, parties(name_en, party_code), warehouses(name)")
    .eq("company_id", company.id)
    .order("return_date", { ascending: false })
    .limit(500);

  const rows = (returns || []).map((r) => {
    const party = Array.isArray(r.parties) ? r.parties[0] : r.parties;
    const wh = Array.isArray(r.warehouses) ? r.warehouses[0] : r.warehouses;
    return {
      id: r.id,
      docNo: r.return_no,
      date: r.return_date,
      partyLabel: party ? `${party.party_code} — ${party.name_en}` : "—",
      warehouseLabel: wh?.name || "—",
      total: Number(r.grand_total || 0),
      href: `/sales/returns/${r.id}`,
      table: "sale_returns",
      linesTable: "sale_return_items",
      linesFk: "sale_return_id",
    };
  });

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

      <DocumentListTable title="Sale returns" rows={rows} />
    </div>
  );
}

import { TransfersTable } from "@/components/tables/transfers-table";
import { StockTransferForm } from "@/components/trading/stock-transfer-form";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { loadTradingMasters } from "@/lib/trading-data";

export default async function StockTransfersPage() {
  const { company, products, warehouses, supabase } = await loadTradingMasters();

  const { data: transfers } = await supabase
    .from("stock_transfers")
    .select(
      "*, from_warehouse:warehouses!stock_transfers_from_warehouse_id_fkey(name), to_warehouse:warehouses!stock_transfers_to_warehouse_id_fkey(name)",
    )
    .eq("company_id", company.id)
    .order("transfer_date", { ascending: false })
    .limit(500);

  const rows = (transfers || []).map((t) => {
    const from = Array.isArray(t.from_warehouse)
      ? t.from_warehouse[0]
      : t.from_warehouse;
    const to = Array.isArray(t.to_warehouse) ? t.to_warehouse[0] : t.to_warehouse;
    return {
      id: t.id,
      transfer_no: t.transfer_no,
      transfer_date: t.transfer_date,
      from_name: from?.name || "—",
      to_name: to?.name || "—",
    };
  });

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Warehouse Transfer"
        description="Move stock between warehouses / brand locations"
        actions={
          <CreateDialogButton
            label="New transfer"
            title="New warehouse transfer"
            description="Move stock between locations"
            size="lg"
            disabled={warehouses.length < 2}
            disabledHint="Create at least two warehouses before transferring stock."
          >
              <StockTransferForm
                companyId={company.id}
                organizationId={company.organization_id}
                products={products}
                warehouses={warehouses}
              />
          </CreateDialogButton>
        }
      />

      <TransfersTable rows={rows} />
    </div>
  );
}

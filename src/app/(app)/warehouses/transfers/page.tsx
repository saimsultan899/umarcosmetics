import { TransfersTable } from "@/components/tables/transfers-table";
import { StockTransferForm } from "@/components/trading/stock-transfer-form";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { fetchStockTransferList } from "@/lib/queries/stock-transfers";
import { loadTradingMasters } from "@/lib/trading-data";
import { Suspense } from "react";

export default async function StockTransfersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { company, products, warehouses, supabase } = await loadTradingMasters();
  const list = await fetchStockTransferList(supabase, company.id, sp);

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

      <Suspense fallback={<PageSkeleton />}>
        <TransfersTable
          rows={list.rows}
          pagination={list.pagination}
          warehouses={warehouses}
        />
      </Suspense>
    </div>
  );
}

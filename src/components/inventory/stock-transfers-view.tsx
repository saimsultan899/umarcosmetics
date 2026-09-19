"use client";

import { TransfersTable } from "@/components/tables/transfers-table";
import { StockTransferForm } from "@/components/trading/stock-transfer-form";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useStockTransferList } from "@/hooks/use-inventory-lists";
import type { StockTransferListResult } from "@/lib/queries/stock-transfers";
import type { Company, Product, Warehouse } from "@/lib/types/database";

export function StockTransfersView({
  company,
  initialData,
  initialWarehouses = [],
  initialProducts = [],
  initialOffline = false,
}: {
  company: Company;
  initialData?: StockTransferListResult | null;
  initialWarehouses?: Warehouse[];
  initialProducts?: Product[];
  initialOffline?: boolean;
}) {
  const { rows, pagination, warehouses, products, loading, refetch } =
    useStockTransferList({
      companyId: company.id,
      initialData,
      initialWarehouses,
      initialProducts,
      initialOffline,
    });

  if (loading && !rows.length) {
    return <PageSkeleton />;
  }

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Company transfer"
        description="Move stock between companies / brand locations"
        actions={
          <CreateDialogButton
            label="New transfer"
            title="New company transfer"
            description="Move stock between companies"
            size="lg"
            disabled={warehouses.length < 2}
            disabledHint="Create at least two companies before transferring stock."
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

      <TransfersTable
        rows={rows}
        pagination={pagination}
        warehouses={warehouses}
      />
    </div>
  );
}

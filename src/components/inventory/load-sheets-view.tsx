"use client";

import { LoadSheetsTable } from "@/components/tables/load-sheets-table";
import { LoadSheetForm } from "@/components/trading/load-sheet-form";
import { Button } from "@/components/ui/button";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useLoadSheetList } from "@/hooks/use-inventory-lists";
import type { LoadSheetListResult } from "@/lib/queries/load-sheets";
import type { Company, Product, Warehouse } from "@/lib/types/database";
import Link from "next/link";

export function LoadSheetsView({
  company,
  initialData,
  initialWarehouses = [],
  initialProducts = [],
  initialSalesmen = [],
  initialOffline = false,
}: {
  company: Company;
  initialData?: LoadSheetListResult | null;
  initialWarehouses?: Warehouse[];
  initialProducts?: Product[];
  initialSalesmen?: Array<{ user_id: string; full_name: string | null; phone?: string | null }>;
  initialOffline?: boolean;
}) {
  const { rows, pagination, warehouses, products, salesmen, loading, refetch } =
    useLoadSheetList({
      companyId: company.id,
      initialData,
      initialWarehouses,
      initialProducts,
      initialSalesmen,
      initialOffline,
    });

  const canCreate = warehouses.length > 0 && products.length > 0;

  if (loading && !rows.length) {
    return <PageSkeleton />;
  }

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Van load sheets"
        description={`Issue stock to salesman vans before market — for ${company.name}`}
        actions={
          <>
            <Link href="/inventory/expiry">
              <Button variant="secondary" size="sm">
                Expiry warehouse
              </Button>
            </Link>
            <CreateDialogButton
              label="Create load"
              title="Create load sheet"
              description="Issue van stock for a market sector"
              size="xl"
              disabled={!canCreate}
              disabledHint="Add products and companies first, then create van loads."
            >
              <LoadSheetForm
                companyId={company.id}
                organizationId={company.organization_id}
                products={products}
                warehouses={warehouses}
                salesmen={salesmen}
              />
            </CreateDialogButton>
          </>
        }
      />

      <LoadSheetsTable
        rows={rows}
        pagination={pagination}
        warehouses={warehouses}
      />
    </div>
  );
}

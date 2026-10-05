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
import { CatalogSlot, useTradingCatalog } from "@/lib/trading/catalog-client";
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
  const catalog = useTradingCatalog(company.id, {
    enabled: !initialOffline,
    salesmen: true,
  });
  const formProducts = products.length ? products : catalog.products;
  const formWarehouses = warehouses.length ? warehouses : catalog.warehouses;
  const canCreate =
    initialOffline ||
    !catalog.ready ||
    Boolean(catalog.error) ||
    (formWarehouses.length > 0 && formProducts.length > 0);

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
              <CatalogSlot
                ready={initialOffline || products.length > 0 || catalog.ready}
                error={catalog.error}
              >
                <LoadSheetForm
                  companyId={company.id}
                  organizationId={company.organization_id}
                  products={formProducts}
                  warehouses={formWarehouses}
                  salesmen={salesmen.length ? salesmen : catalog.salesmen}
                />
              </CatalogSlot>
            </CreateDialogButton>
          </>
        }
      />

      <LoadSheetsTable
        rows={rows}
        pagination={pagination}
        warehouses={formWarehouses}
      />
    </div>
  );
}

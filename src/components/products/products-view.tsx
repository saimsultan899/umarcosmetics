"use client";

import { ProductForm } from "@/components/forms/product-form";
import { ProductsTable } from "@/components/tables/products-table";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useProductsList } from "@/hooks/use-products-list";
import type { ProductListResult } from "@/lib/queries/products";
import type { Company, Warehouse } from "@/lib/types/database";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

export function ProductsView({
  company,
  initialData,
  initialWarehouses,
  initialOffline = false,
}: {
  company: Company;
  initialData?: ProductListResult | null;
  initialWarehouses?: Warehouse[];
  initialOffline?: boolean;
}) {
  const searchParams = useSearchParams();
  const view = searchParams.get("view") || undefined;

  const { data, warehouses, loading, refetch } = useProductsList({
    companyId: company.id,
    initialData,
    initialWarehouses,
    initialOffline,
  });

  if (loading && !data) {
    return <PageSkeleton />;
  }

  const currentData = data || {
    products: [],
    pagination: { page: 1, pageSize: 24 as const, total: 0, totalPages: 1, from: 0, to: 0 },
    stats: {
      total: 0,
      stockValue: 0,
      withReorder: 0,
      lowStock: 0,
      makerBars: [],
      topStock: [],
      health: [],
    },
    stockValueByCode: {},
    lowStockCodes: [],
  };

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Products"
        description="Inventory masters with rates, packing, and reorder levels. Expired customer returns are held in Expiry Warehouse, not saleable stock."
        actions={
          <>
            <Link
              href="/inventory/expiry"
              className="inline-flex h-8 items-center rounded-md border border-[var(--border)] bg-white px-3 text-xs font-semibold text-[var(--ink)] hover:border-[var(--brand)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand-strong)]"
            >
              Expiry warehouse
            </Link>
            <CreateDialogButton
              label="Add product"
              title="Add product"
              description="Create a catalog item with rates and packing"
              size="xl"
            >
              <ProductForm
                companyId={company.id}
                organizationId={company.organization_id}
                warehouses={warehouses}
                onDone={refetch}
              />
            </CreateDialogButton>
          </>
        }
      />

      <ProductsTable
        products={currentData.products}
        pagination={currentData.pagination}
        stats={currentData.stats}
        warehouses={warehouses}
        companyId={company.id}
        organizationId={company.organization_id}
        stockValueByCode={currentData.stockValueByCode}
        lowStockCodes={currentData.lowStockCodes}
        initialView={view}
      />
    </div>
  );
}

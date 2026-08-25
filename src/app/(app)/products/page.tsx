import { ProductForm } from "@/components/forms/product-form";
import { ProductsTable } from "@/components/tables/products-table";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { requireCompanyContext } from "@/lib/auth";
import { fetchProductList } from "@/lib/queries/products";
import type { Warehouse } from "@/lib/types/database";
import { Suspense } from "react";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();

  const [{ data: warehouses }, list] = await Promise.all([
    supabase
      .from("warehouses")
      .select("*")
      .eq("company_id", company.id)
      .eq("is_active", true)
      .order("name"),
    fetchProductList(supabase, company.id, sp),
  ]);

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Products"
        description="Inventory masters with rates, packing, and reorder levels. Stats follow table filters."
        actions={
          <CreateDialogButton
            label="Add product"
            title="Add product"
            description="Create a catalog item with rates and packing"
            size="xl"
          >
            <ProductForm
              companyId={company.id}
              organizationId={company.organization_id}
              warehouses={(warehouses as Warehouse[]) || []}
            />
          </CreateDialogButton>
        }
      />

      <Suspense fallback={<PageSkeleton />}>
        <ProductsTable
          products={list.products}
          pagination={list.pagination}
          stats={list.stats}
          warehouses={(warehouses as Warehouse[]) || []}
          companyId={company.id}
          organizationId={company.organization_id}
          stockValueByCode={list.stockValueByCode}
          lowStockCodes={list.lowStockCodes}
          initialView={typeof sp.view === "string" ? sp.view : undefined}
        />
      </Suspense>
    </div>
  );
}

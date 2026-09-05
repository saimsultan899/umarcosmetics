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
import Link from "next/link";
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
                warehouses={(warehouses as Warehouse[]) || []}
              />
            </CreateDialogButton>
          </>
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

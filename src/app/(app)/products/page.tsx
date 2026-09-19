import { ProductsView } from "@/components/products/products-view";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { requireCompanyContext } from "@/lib/auth";
import { fetchProductList, type ProductListResult } from "@/lib/queries/products";
import type { Warehouse } from "@/lib/types/database";
import { Suspense } from "react";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, company, offline } = await requireCompanyContext();

  let initialData: ProductListResult | null = null;
  let initialWarehouses: Warehouse[] = [];

  if (!offline) {
    try {
      const [{ data: warehouses }, list] = await Promise.all([
        supabase
          .from("warehouses")
          .select("*")
          .eq("company_id", company.id)
          .eq("is_active", true)
          .order("name"),
        fetchProductList(supabase, company.id, sp),
      ]);
      initialWarehouses = (warehouses as Warehouse[]) || [];
      initialData = list;
    } catch {
      initialData = null;
    }
  }

  return (
    <Suspense fallback={<PageSkeleton />}>
      <ProductsView
        company={company}
        initialData={initialData}
        initialWarehouses={initialWarehouses}
        initialOffline={offline}
      />
    </Suspense>
  );
}

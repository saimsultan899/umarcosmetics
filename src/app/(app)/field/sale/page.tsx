import { FieldSaleForm } from "@/components/field/field-sale-form";
import { requireCompanyContext } from "@/lib/auth";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import type { Product, Warehouse } from "@/lib/types/database";

export default async function FieldSalePage() {
  const ctx = await requireCompanyContext();
  const { supabase, company, offline } = ctx;
  if (offline) {
    const { OfflineFieldSalePage } = await import(
      "@/components/offline/offline-field-pages"
    );
    return (
      <OfflineFieldSalePage
        companyId={company.id}
        organizationId={company.organization_id}
      />
    );
  }

  const [{ data: shops }, products, { data: warehouses }, { data: stockRows }] =
    await Promise.all([
      supabase.rpc("get_salesman_shops", {
        p_company_id: company.id,
        p_as_of: new Date().toISOString().slice(0, 10),
      }),
      fetchAllPages<Product>((from, to) =>
        supabase
          .from("products")
          .select(
            "id, code, name_en, default_warehouse_id, sale_rate, retail_rate, purchase_rate, wholesale_rate, is_active",
          )
          .eq("company_id", company.id)
          .eq("is_active", true)
          .order("code", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      ).catch(() => [] as Product[]),
      supabase
        .from("warehouses")
        .select("*")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("stock_balances")
        .select("product_id, warehouse_id, qty")
        .eq("company_id", company.id),
    ]);

  return (
    <div className="animate-rise mx-auto w-full max-w-3xl space-y-5">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold sm:text-3xl">
          Quick sale
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Credit sale from market — queues offline if needed
        </p>
      </div>
      <div className="panel p-4 sm:p-6">
        <FieldSaleForm
          companyId={company.id}
          organizationId={company.organization_id}
          shops={(shops || []) as Array<{
            party_id: string;
            party_code: string;
            name_en: string;
            route: string | null;
            city: string | null;
          }>}
          products={products}
          warehouses={(warehouses || []) as Warehouse[]}
          stockBalances={stockRows || []}
          saleStockPolicy={company.sale_stock_policy === "block" ? "block" : "confirm"}
        />
      </div>
    </div>
  );
}

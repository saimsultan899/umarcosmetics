import { FieldHeader, FieldLinkButton } from "@/components/field/field-frame";
import {
  FieldProductCatalog,
  type CatalogProduct,
} from "@/components/field/field-product-catalog";
import { effectivePermissions } from "@/lib/access/permissions";
import { requireCompanyContext } from "@/lib/auth";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import { redirect } from "next/navigation";

type ProductRow = {
  id: string;
  code: string | null;
  name_en: string;
  sale_rate: number | null;
  retail_rate: number | null;
  default_warehouse_id: string | null;
};

export default async function FieldProductsPage() {
  const { supabase, company, membership, offline } = await requireCompanyContext();
  const permissions = effectivePermissions(membership);
  if (membership?.role === "salesman" && !permissions.includes("edit_products")) {
    redirect("/field");
  }
  if (offline) {
    return (
      <p className="rounded-[var(--radius)] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Products need a connection.
      </p>
    );
  }

  const [products, { data: warehouses }, { data: stock }] = await Promise.all([
    fetchAllPages<ProductRow>((from, to) =>
      supabase
        .from("products")
        .select("id, code, name_en, sale_rate, retail_rate, default_warehouse_id")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("name_en")
        .order("id")
        .range(from, to),
    ).catch(() => [] as ProductRow[]),
    supabase
      .from("warehouses")
      .select("id, name")
      .eq("company_id", company.id)
      .eq("is_active", true),
    supabase.from("stock_balances").select("product_id, qty").eq("company_id", company.id),
  ]);

  const companyName = new Map((warehouses || []).map((row) => [row.id, row.name]));
  const onHand = new Map<string, number>();
  for (const row of stock || []) {
    onHand.set(row.product_id, (onHand.get(row.product_id) || 0) + Number(row.qty || 0));
  }
  const catalog: CatalogProduct[] = products.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name_en,
    warehouseId: row.default_warehouse_id,
    company: (row.default_warehouse_id && companyName.get(row.default_warehouse_id)) || "No company",
    tradePrice: Number(row.sale_rate || 0) > 0 ? Number(row.sale_rate) : Number(row.retail_rate || 0),
    onHand: onHand.get(row.id) || 0,
  }));

  return (
    <div className="animate-rise space-y-5">
      <FieldHeader
        title="Products"
        description="Trade price and stock on hand. Edit opens the product register."
        actions={<FieldLinkButton href="/products" tone="solid">Edit products</FieldLinkButton>}
      />
      <FieldProductCatalog
        products={catalog}
        companies={[...new Set(catalog.map((row) => row.company))].sort((a, b) => a.localeCompare(b))}
      />
    </div>
  );
}

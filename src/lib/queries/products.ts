import {
  buildPaginationMeta,
  escapeIlike,
  parsePaginationParams,
  spString,
  toRange,
  type PaginationMeta,
} from "@/lib/pagination";
import type { Product } from "@/lib/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ProductViewFilter = "all" | "reorder";

export type ProductListStats = {
  total: number;
  stockValue: number;
  withReorder: number;
  lowStock: number;
  makerBars: Array<{ name: string; value: number }>;
  topStock: Array<{ name: string; value: number }>;
  health: Array<{ name: string; value: number }>;
};

export type ProductListResult = {
  products: Product[];
  pagination: PaginationMeta;
  stats: ProductListStats;
  stockValueByCode: Record<string, number>;
  lowStockCodes: string[];
};

function applyProductWarehouse(query: any, warehouseId: string) {
  if (warehouseId) return query.eq("default_warehouse_id", warehouseId);
  return query;
}

function applyProductView(query: any, view: ProductViewFilter) {
  if (view === "reorder") return query.gt("reorder_level", 0);
  return query;
}

function applyProductSearch(query: any, q: string) {
  const term = escapeIlike(q);
  if (!term) return query;
  const pattern = `%${term}%`;
  return query.or(
    [
      `code.ilike.${pattern}`,
      `name_en.ilike.${pattern}`,
      `manufacturer.ilike.${pattern}`,
      `category_group.ilike.${pattern}`,
      `product_type.ilike.${pattern}`,
    ].join(","),
  );
}

export async function fetchProductList(
  supabase: SupabaseClient,
  companyId: string,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<ProductListResult> {
  const paginationParams = parsePaginationParams(searchParams);
  const { from, to } = toRange(paginationParams);
  const q = spString(searchParams, "q") || "";
  const view = (spString(searchParams, "view") || "all") as ProductViewFilter;
  const warehouseId = spString(searchParams, "warehouse") || "";

  let listQuery = supabase
    .from("products")
    .select("*", { count: "exact" })
    .eq("company_id", companyId)
    .eq("is_active", true);
  listQuery = applyProductView(listQuery, view);
  listQuery = applyProductWarehouse(listQuery, warehouseId);
  listQuery = applyProductSearch(listQuery, q);

  const [{ data, count, error }, { data: balances }, { count: withReorder }] =
    await Promise.all([
      listQuery.order("code", { ascending: true }).range(from, to),
      supabase
        .from("stock_balances")
        .select("qty, products(code, name_en, sale_rate, reorder_level)")
        .eq("company_id", companyId)
        .limit(8000),
      (async () => {
        let query = supabase
          .from("products")
          .select("*", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("is_active", true)
          .gt("reorder_level", 0);
        query = applyProductWarehouse(query, warehouseId);
        query = applyProductSearch(query, q);
        return query;
      })(),
    ]);

  if (error) throw new Error(error.message);

  const stockValueByCode: Record<string, number> = {};
  const lowStockCodes: string[] = [];

  for (const row of balances || []) {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    if (!product?.code) continue;
    const qty = Number(row.qty || 0);
    const rate = Number(product.sale_rate || 0);
    stockValueByCode[product.code] =
      (stockValueByCode[product.code] || 0) + qty * rate;
    if (
      Number(product.reorder_level) > 0 &&
      qty <= Number(product.reorder_level) &&
      !lowStockCodes.includes(product.code)
    ) {
      lowStockCodes.push(product.code);
    }
  }

  const lowSet = new Set(lowStockCodes);
  const products = (data || []) as Product[];
  const total = count ?? 0;
  const meta = buildPaginationMeta(total, paginationParams);

  const stockValue = products.reduce(
    (sum, p) => sum + Number(stockValueByCode[p.code] || 0),
    0,
  );
  const lowCount = products.filter((p) => lowSet.has(p.code)).length;

  const makers = new Map<string, number>();
  for (const p of products) {
    const key = p.manufacturer || "Unbranded";
    makers.set(key, (makers.get(key) || 0) + 1);
  }

  const topStock = products
    .map((p) => ({
      name: `${p.code} — ${p.name_en}`,
      value: Number(stockValueByCode[p.code] || 0),
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const health = [
    { name: "Healthy", value: Math.max(products.length - lowCount, 0) },
    { name: "Low stock", value: lowCount },
  ].filter((x) => x.value > 0);

  return {
    products,
    pagination: meta,
    stats: {
      total,
      stockValue,
      withReorder: withReorder ?? 0,
      lowStock: lowStockCodes.length,
      makerBars: [...makers.entries()]
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6),
      topStock,
      health,
    },
    stockValueByCode,
    lowStockCodes,
  };
}

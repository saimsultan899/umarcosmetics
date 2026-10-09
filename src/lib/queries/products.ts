import {
  buildPaginationMeta,
  escapeIlike,
  parsePaginationParams,
  spString,
  toRange,
  type PaginationMeta,
} from "@/lib/pagination";
import type { Product, Warehouse } from "@/lib/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ProductViewFilter = "all" | "reorder";

export type ProductListStats = {
  total: number;
  /** On-hand qty × retail rate for the filtered catalog. */
  stockValue: number;
  /** On-hand qty × purchase rate for the same filtered catalog. */
  purchaseValue: number;
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
    .eq("company_id", companyId);
  listQuery = applyProductView(listQuery, view);
  listQuery = applyProductWarehouse(listQuery, warehouseId);
  listQuery = applyProductSearch(listQuery, q);

  let valueQuery = supabase
    .from("products")
    .select("id, code, name_en, retail_rate, purchase_rate, reorder_level, is_active, hub_product_id, default_warehouse_id")
    .eq("company_id", companyId)
    .limit(10000);
  valueQuery = applyProductView(valueQuery, view);
  valueQuery = applyProductWarehouse(valueQuery, warehouseId);
  valueQuery = applyProductSearch(valueQuery, q);

  const [{ data, count, error }, { data: balances }, { data: valued }, { data: warehouses }] =
    await Promise.all([
      listQuery.order("code", { ascending: true }).range(from, to),
      supabase
        .from("stock_balances")
        .select("product_id, warehouse_id, qty, products(code, reorder_level)")
        .eq("company_id", companyId)
        .limit(8000),
      valueQuery,
      supabase
        .from("warehouses")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("is_active", true),
    ]);

  if (error) throw new Error(error.message);

  const productsForOverlay = (valued || []) as Product[];
  const { withHubStockOverlay } = await import("@/lib/trading/hub-stock");
  const overlaid = await withHubStockOverlay(
    supabase,
    companyId,
    productsForOverlay,
    (warehouses || []) as Warehouse[],
    (balances || []).map((row) => ({
      product_id: String(row.product_id || ""),
      warehouse_id: String(row.warehouse_id || ""),
      qty: Number(row.qty || 0),
    })),
  );

  const stockValueByCode: Record<string, number> = {};
  const lowStockCodes: string[] = [];
  const qtyByProduct = new Map<string, number>();
  const reorderByProduct = new Map<string, { code: string; reorder: number }>();

  for (const row of balances || []) {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    const productId = String(row.product_id || "");
    if (productId && product?.code) {
      reorderByProduct.set(productId, {
        code: product.code,
        reorder: Number(product.reorder_level || 0),
      });
    }
  }

  for (const row of overlaid) {
    const productId = String(row.product_id || "");
    const qty = Number(row.qty || 0);
    if (productId) {
      qtyByProduct.set(productId, (qtyByProduct.get(productId) || 0) + qty);
    }
  }

  for (const [productId, meta] of reorderByProduct) {
    const qty = qtyByProduct.get(productId) || 0;
    if (meta.reorder > 0 && qty <= meta.reorder && !lowStockCodes.includes(meta.code)) {
      lowStockCodes.push(meta.code);
    }
  }

  let stockValue = 0;
  let purchaseValue = 0;
  for (const product of valued || []) {
    const qty = qtyByProduct.get(product.id) || 0;
    const retail = qty * Number(product.retail_rate || 0);
    const purchase = qty * Number(product.purchase_rate || 0);
    stockValue += retail;
    purchaseValue += purchase;
    if (product.code) stockValueByCode[product.code] = retail;
  }

  const lowSet = new Set(lowStockCodes);
  const products = (data || []) as Product[];
  const total = count ?? 0;
  const meta = buildPaginationMeta(total, paginationParams);

  const lowCount = products.filter((p) => lowSet.has(p.code)).length;

  const makers = new Map<string, number>();
  for (const p of products) {
    const key = p.default_warehouse_id || "unassigned";
    makers.set(key, (makers.get(key) || 0) + 1);
  }

  const topStock = (valued || [])
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
      purchaseValue,
      withReorder: (valued || []).filter(
        (product) => product.is_active && Number(product.reorder_level) > 0,
      ).length,
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

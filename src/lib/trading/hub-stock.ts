import type { Product, Warehouse } from "@/lib/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export type StockBalanceLite = {
  product_id: string;
  warehouse_id: string;
  qty: number;
};

function norm(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * For spoke companies in a hub org, map main-company stock onto spoke
 * product + warehouse ids (matched by hub_product_id and warehouse name).
 * Local spoke balances for linked products are replaced by hub qty.
 */
export function mapHubStockOntoSpoke(opts: {
  products: Product[];
  warehouses: Warehouse[];
  localStock: StockBalanceLite[];
  hubProducts: Array<{ id: string; hub_product_id?: string | null }>;
  hubWarehouses: Array<{ id: string; name: string }>;
  hubStock: StockBalanceLite[];
}): StockBalanceLite[] {
  const {
    products,
    warehouses,
    localStock,
    hubWarehouses,
    hubStock,
  } = opts;

  const hubWhByName = new Map<string, string>();
  for (const w of hubWarehouses) {
    const key = norm(w.name);
    if (key && !hubWhByName.has(key)) hubWhByName.set(key, w.id);
  }

  const spokeWhByHubWh = new Map<string, string>();
  for (const w of warehouses) {
    const hubWhId = hubWhByName.get(norm(w.name));
    if (hubWhId) spokeWhByHubWh.set(hubWhId, w.id);
  }

  const spokeByHubProduct = new Map<string, string>();
  for (const p of products) {
    if (p.hub_product_id) {
      spokeByHubProduct.set(String(p.hub_product_id), p.id);
    }
  }

  if (spokeByHubProduct.size === 0) return localStock;

  const linkedSpokeIds = new Set(spokeByHubProduct.values());
  const merged = localStock.filter((row) => !linkedSpokeIds.has(row.product_id));

  for (const row of hubStock) {
    const spokeProductId = spokeByHubProduct.get(row.product_id);
    if (!spokeProductId) continue;
    const spokeWhId = spokeWhByHubWh.get(row.warehouse_id);
    if (!spokeWhId) continue;
    merged.push({
      product_id: spokeProductId,
      warehouse_id: spokeWhId,
      qty: Number(row.qty) || 0,
    });
  }

  return merged;
}

/** Load org main company id for a company (null when hub is off). */
export async function fetchMainCompanyId(
  supabase: SupabaseClient,
  companyId: string,
): Promise<string | null> {
  const { data: company } = await supabase
    .from("companies")
    .select("organization_id")
    .eq("id", companyId)
    .maybeSingle();
  const orgId = company?.organization_id as string | undefined;
  if (!orgId) return null;

  const { data: org } = await supabase
    .from("organizations")
    .select("main_company_id")
    .eq("id", orgId)
    .maybeSingle();

  return (org?.main_company_id as string | null) || null;
}

/** Overlay hub stock onto spoke catalog balances when this company is a spoke. */
export async function withHubStockOverlay(
  supabase: SupabaseClient,
  companyId: string,
  products: Product[],
  warehouses: Warehouse[],
  localStock: StockBalanceLite[],
): Promise<StockBalanceLite[]> {
  const linked = products.filter((p) => p.hub_product_id);
  if (!linked.length) return localStock;

  const mainId = await fetchMainCompanyId(supabase, companyId);
  if (!mainId || mainId === companyId) return localStock;

  const hubProductIds = [
    ...new Set(linked.map((p) => String(p.hub_product_id))),
  ];

  const [{ data: hubStock }, { data: hubWarehouses }] = await Promise.all([
    supabase
      .from("stock_balances")
      .select("product_id, warehouse_id, qty")
      .eq("company_id", mainId)
      .in("product_id", hubProductIds),
    supabase
      .from("warehouses")
      .select("id, name")
      .eq("company_id", mainId)
      .eq("is_active", true),
  ]);

  return mapHubStockOntoSpoke({
    products,
    warehouses,
    localStock,
    hubProducts: linked.map((p) => ({
      id: p.id,
      hub_product_id: p.hub_product_id,
    })),
    hubWarehouses: (hubWarehouses || []) as Array<{ id: string; name: string }>,
    hubStock: (hubStock || []) as StockBalanceLite[],
  });
}

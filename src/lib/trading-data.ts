import type { Party, Product, Warehouse } from "@/lib/types/database";
import { requireCompanyContext } from "@/lib/auth";

export async function loadTradingMasters() {
  const ctx = await requireCompanyContext();
  const { supabase, company, offline } = ctx;

  if (offline) {
    return {
      ...ctx,
      parties: [] as Party[],
      products: [] as Product[],
      warehouses: [] as Warehouse[],
    };
  }

  async function pageAll<T>(
    make: (
      from: number,
      to: number,
    ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  ) {
    const pageSize = 1000;
    const rows: T[] = [];
    for (let from = 0; from < 50000; from += pageSize) {
      const { data, error } = await make(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const batch = data || [];
      rows.push(...batch);
      if (batch.length < pageSize) break;
    }
    return rows;
  }

  const [parties, products, warehouses] = await Promise.all([
    pageAll<Party>((from, to) =>
      supabase
        .from("parties")
        .select("*")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name_en")
        .range(from, to),
    ),
    pageAll<Product>((from, to) =>
      supabase
        .from("products")
        .select("*")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("code")
        .range(from, to),
    ),
    pageAll<Warehouse>((from, to) =>
      supabase
        .from("warehouses")
        .select("*")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("name")
        .range(from, to),
    ),
  ]);

  return {
    ...ctx,
    parties,
    products,
    warehouses,
  };
}

import type { Party, Product, Warehouse } from "@/lib/types/database";
import { requireCompanyContext } from "@/lib/auth";

export async function loadTradingMasters() {
  const ctx = await requireCompanyContext();
  const { supabase, company } = ctx;

  const [{ data: parties }, { data: products }, { data: warehouses }] =
    await Promise.all([
      supabase
        .from("parties")
        .select("*")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("name_en"),
      supabase
        .from("products")
        .select("*")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("code"),
      supabase
        .from("warehouses")
        .select("*")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("name"),
    ]);

  return {
    ...ctx,
    parties: (parties || []) as Party[],
    products: (products || []) as Product[],
    warehouses: (warehouses || []) as Warehouse[],
  };
}

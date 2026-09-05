import type { SupabaseClient } from "@supabase/supabase-js";

export type ExpiryStockRow = {
  product_id: string;
  product_code: string;
  product_name: string;
  qty: number;
  rate: number;
  amount: number;
};

export type CustomerSaleHistoryRow = {
  product_id: string;
  product_code: string;
  product_name: string;
  qty: number;
  amount: number;
  avg_rate: number;
};

export async function fetchExpiryStock(
  supabase: SupabaseClient,
  companyId: string,
): Promise<ExpiryStockRow[]> {
  const { data, error } = await supabase
    .from("expiry_stock_balances")
    .select("product_id, qty, products(code, name_en, purchase_rate)")
    .eq("company_id", companyId)
    .gt("qty", 0)
    .order("qty", { ascending: false });

  if (error) throw new Error(error.message);

  return (data || []).map((row) => {
    const product = Array.isArray(row.products) ? row.products[0] : row.products;
    const qty = Number(row.qty || 0);
    const rate = Number(product?.purchase_rate || 0);
    return {
      product_id: row.product_id,
      product_code: product?.code || "",
      product_name: product?.name_en || "",
      qty,
      rate,
      amount: qty * rate,
    };
  });
}

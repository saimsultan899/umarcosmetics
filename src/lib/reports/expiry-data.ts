import { one } from "@/lib/reports/helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ExpiryReportView = "onhand" | "returns" | "claims";

export const EXPIRY_REPORT_VIEWS: { key: ExpiryReportView; label: string }[] = [
  { key: "onhand", label: "On-hand" },
  { key: "returns", label: "Customer returns" },
  { key: "claims", label: "Vendor claims" },
];

export async function buildExpiryReport(
  supabase: SupabaseClient,
  filters: {
    companyId: string;
    view: ExpiryReportView;
    from: string;
    to: string;
    warehouseId?: string;
  },
): Promise<Record<string, unknown>[]> {
  const { data: warehouses } = await supabase
    .from("warehouses")
    .select("id, name")
    .eq("company_id", filters.companyId);
  const companyByWarehouse = new Map(
    (warehouses || []).map((w) => [w.id as string, w.name as string]),
  );

  function companyName(
    warehouseId?: string | null,
    fallback?: string | null,
  ) {
    if (warehouseId && companyByWarehouse.has(warehouseId)) {
      return companyByWarehouse.get(warehouseId) || "—";
    }
    return fallback || "—";
  }

  if (filters.view === "onhand") {
    const { data, error } = await supabase
      .from("expiry_stock_balances")
      .select(
        "qty, products(code, name_en, purchase_rate, default_warehouse_id)",
      )
      .eq("company_id", filters.companyId)
      .gt("qty", 0)
      .order("qty", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);

    return (data || [])
      .map((row) => {
        const product = one(row.products);
        const qty = Number(row.qty || 0);
        const rate = Number(product?.purchase_rate || 0);
        const warehouseId = product?.default_warehouse_id as string | null;
        if (filters.warehouseId && warehouseId !== filters.warehouseId) {
          return null;
        }
        return {
          Company: companyName(warehouseId),
          Code: product?.code || "—",
          Item: product?.name_en || "—",
          Qty: qty,
          Rate: rate,
          Amount: qty * rate,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);
  }

  if (filters.view === "returns") {
    const { data: receipts, error } = await supabase
      .from("expiry_receipts")
      .select(
        "id, receipt_no, receipt_date, grand_total, parties(party_code, name_en)",
      )
      .eq("company_id", filters.companyId)
      .gte("receipt_date", filters.from)
      .lte("receipt_date", filters.to)
      .order("receipt_date", { ascending: true })
      .limit(2000);
    if (error) throw new Error(error.message);
    if (!receipts?.length) return [];

    const { data: items, error: itemError } = await supabase
      .from("expiry_receipt_items")
      .select(
        "receipt_id, product_code, product_name, qty, rate, amount, products(default_warehouse_id)",
      )
      .in(
        "receipt_id",
        receipts.map((r) => r.id),
      );
    if (itemError) throw new Error(itemError.message);

    const receiptMap = new Map(receipts.map((r) => [r.id, r]));
    return (items || [])
      .map((it) => {
        const doc = receiptMap.get(it.receipt_id);
        const product = one(it.products);
        const party = one(doc?.parties);
        const warehouseId = product?.default_warehouse_id as string | null;
        if (filters.warehouseId && warehouseId !== filters.warehouseId) {
          return null;
        }
        return {
          Date: doc?.receipt_date,
          No: doc?.receipt_no,
          Customer: party
            ? `${party.party_code} — ${party.name_en}`
            : "—",
          Company: companyName(warehouseId),
          Code: it.product_code,
          Item: it.product_name,
          Qty: Number(it.qty),
          Rate: Number(it.rate),
          Amount: Number(it.amount),
          _href: doc?.id ? `/inventory/expiry/receipts/${doc.id}` : "",
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);
  }

  const { data: claims, error } = await supabase
    .from("expiry_claims")
    .select(
      "id, claim_no, claim_date, claim_status, grand_total, warehouse_id, parties(party_code, name_en), warehouses(name)",
    )
    .eq("company_id", filters.companyId)
    .gte("claim_date", filters.from)
    .lte("claim_date", filters.to)
    .order("claim_date", { ascending: true })
    .limit(2000);
  if (error) throw new Error(error.message);

  const claimList = (claims || []).filter(
    (c) => !filters.warehouseId || c.warehouse_id === filters.warehouseId,
  );
  if (!claimList.length) return [];

  const { data: items, error: itemError } = await supabase
    .from("expiry_claim_items")
    .select(
      "claim_id, product_code, product_name, qty, rate, amount, products(default_warehouse_id)",
    )
    .in(
      "claim_id",
      claimList.map((c) => c.id),
    );
  if (itemError) throw new Error(itemError.message);

  const claimMap = new Map(claimList.map((c) => [c.id, c]));
  return (items || []).map((it) => {
    const doc = claimMap.get(it.claim_id);
    const product = one(it.products);
    const party = one(doc?.parties);
    const headerWh = one(doc?.warehouses);
    const warehouseId =
      (product?.default_warehouse_id as string | null) || doc?.warehouse_id;
    return {
      Date: doc?.claim_date,
      No: doc?.claim_no,
      Vendor: party ? `${party.party_code} — ${party.name_en}` : "—",
      Company: companyName(warehouseId, headerWh?.name),
      Status: doc?.claim_status || "open",
      Code: it.product_code,
      Item: it.product_name,
      Qty: Number(it.qty),
      Rate: Number(it.rate),
      Amount: Number(it.amount),
      _href: doc?.id ? `/inventory/expiry/claims/${doc.id}` : "",
    };
  });
}

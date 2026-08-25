import {
  buildPaginationMeta,
  escapeIlike,
  parsePaginationParams,
  spString,
  toRange,
  type PaginationMeta,
} from "@/lib/pagination";
import type { SupabaseClient } from "@supabase/supabase-js";

export type StockTransferRow = {
  id: string;
  transfer_no: string;
  transfer_date: string;
  from_name: string;
  to_name: string;
};

export type StockTransferListResult = {
  rows: StockTransferRow[];
  pagination: PaginationMeta;
};

export async function fetchStockTransferList(
  supabase: SupabaseClient,
  companyId: string,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<StockTransferListResult> {
  const paginationParams = parsePaginationParams(searchParams);
  const { from, to } = toRange(paginationParams);
  const q = spString(searchParams, "q") || "";
  const fromWarehouseId = spString(searchParams, "from") || "";
  const toWarehouseId = spString(searchParams, "to") || "";

  let query = supabase
    .from("stock_transfers")
    .select(
      "id, transfer_no, transfer_date, from_warehouse:warehouses!stock_transfers_from_warehouse_id_fkey(name), to_warehouse:warehouses!stock_transfers_to_warehouse_id_fkey(name)",
      { count: "exact" },
    )
    .eq("company_id", companyId);

  if (fromWarehouseId) query = query.eq("from_warehouse_id", fromWarehouseId);
  if (toWarehouseId) query = query.eq("to_warehouse_id", toWarehouseId);

  const term = escapeIlike(q);
  if (term) {
    query = query.ilike("transfer_no", `%${term}%`);
  }

  const { data, count, error } = await query
    .order("transfer_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(error.message);

  const rows = (data || []).map((t) => {
    const fromWh = Array.isArray(t.from_warehouse)
      ? t.from_warehouse[0]
      : t.from_warehouse;
    const toWh = Array.isArray(t.to_warehouse) ? t.to_warehouse[0] : t.to_warehouse;
    return {
      id: t.id,
      transfer_no: t.transfer_no,
      transfer_date: t.transfer_date,
      from_name: fromWh?.name || "—",
      to_name: toWh?.name || "—",
    };
  });

  return {
    rows,
    pagination: buildPaginationMeta(count ?? 0, paginationParams),
  };
}

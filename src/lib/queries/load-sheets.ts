import {
  buildPaginationMeta,
  escapeIlike,
  parsePaginationParams,
  spString,
  toRange,
  type PaginationMeta,
} from "@/lib/pagination";
import { formatNumber } from "@/lib/utils";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LoadSheetRow = {
  id: string;
  sheet_no: string;
  sheet_date: string;
  warehouse: string;
  vehicle_route: string;
  qty: string;
  status: string;
};

export type LoadSheetListResult = {
  rows: LoadSheetRow[];
  pagination: PaginationMeta;
};

export async function fetchLoadSheetList(
  supabase: SupabaseClient,
  companyId: string,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<LoadSheetListResult> {
  const paginationParams = parsePaginationParams(searchParams);
  const { from, to } = toRange(paginationParams);
  const q = spString(searchParams, "q") || "";
  const warehouseId = spString(searchParams, "warehouse") || "";

  let query = supabase
    .from("load_sheets")
    .select(
      "id, sheet_no, sheet_date, vehicle_no, route, status, warehouses(name), load_sheet_items(qty)",
      { count: "exact" },
    )
    .eq("company_id", companyId);

  if (warehouseId) query = query.eq("warehouse_id", warehouseId);

  const term = escapeIlike(q);
  if (term) {
    const pattern = `%${term}%`;
    query = query.or(
      [
        `sheet_no.ilike.${pattern}`,
        `vehicle_no.ilike.${pattern}`,
        `route.ilike.${pattern}`,
        `status.ilike.${pattern}`,
      ].join(","),
    );
  }

  const { data, count, error } = await query
    .order("sheet_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(error.message);

  const rows = (data || []).map((s) => {
    const wh = Array.isArray(s.warehouses) ? s.warehouses[0] : s.warehouses;
    const qty = (s.load_sheet_items || []).reduce(
      (sum: number, i: { qty: number }) => sum + Number(i.qty || 0),
      0,
    );
    return {
      id: s.id,
      sheet_no: s.sheet_no,
      sheet_date: s.sheet_date,
      warehouse: wh?.name || "—",
      vehicle_route:
        [s.vehicle_no, s.route].filter(Boolean).join(" · ") || "—",
      qty: formatNumber(qty, 0),
      status: s.status,
    };
  });

  return {
    rows,
    pagination: buildPaginationMeta(count ?? 0, paginationParams),
  };
}

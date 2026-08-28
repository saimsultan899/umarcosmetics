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

export type GatePassListRow = {
  id: string;
  pass_no: string;
  pass_date: string;
  supplier: string;
  warehouse: string;
  brand: string;
  qty: string;
};

export type GatePassListResult = {
  rows: GatePassListRow[];
  pagination: PaginationMeta;
};

export async function fetchGatePassList(
  supabase: SupabaseClient,
  companyId: string,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<GatePassListResult> {
  const paginationParams = parsePaginationParams(searchParams);
  const { from, to } = toRange(paginationParams);
  const q = spString(searchParams, "q") || "";
  const warehouseId = spString(searchParams, "warehouse") || "";

  let query = supabase
    .from("gate_passes")
    .select(
      "id, pass_no, pass_date, manufacturer, vehicle_no, parties(name_en, party_code), warehouses(name), gate_pass_items(qty)",
      { count: "exact" },
    )
    .eq("company_id", companyId);

  if (warehouseId) query = query.eq("warehouse_id", warehouseId);

  const term = escapeIlike(q);
  if (term) {
    const pattern = `%${term}%`;
    query = query.or(
      [
        `pass_no.ilike.${pattern}`,
        `manufacturer.ilike.${pattern}`,
        `vehicle_no.ilike.${pattern}`,
        `transporter.ilike.${pattern}`,
        `po_no.ilike.${pattern}`,
        `bilty_no.ilike.${pattern}`,
      ].join(","),
    );
  }

  const { data, count, error } = await query
    .order("pass_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(error.message);

  const rows = (data || []).map((s) => {
    const party = Array.isArray(s.parties) ? s.parties[0] : s.parties;
    const wh = Array.isArray(s.warehouses) ? s.warehouses[0] : s.warehouses;
    const qty = (s.gate_pass_items || []).reduce(
      (sum: number, i: { qty: number }) => sum + Number(i.qty || 0),
      0,
    );
    return {
      id: s.id,
      pass_no: s.pass_no,
      pass_date: s.pass_date,
      supplier: party
        ? `${party.party_code} — ${party.name_en}`
        : "—",
      warehouse: wh?.name || "—",
      brand: s.manufacturer || "—",
      qty: formatNumber(qty, 0),
    };
  });

  return {
    rows,
    pagination: buildPaginationMeta(count ?? 0, paginationParams),
  };
}

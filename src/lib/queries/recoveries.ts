import {
  buildPaginationMeta,
  escapeIlike,
  parsePaginationParams,
  spString,
  toRange,
  type PaginationMeta,
} from "@/lib/pagination";
import type { SupabaseClient } from "@supabase/supabase-js";

export type RecoveryRow = {
  id: string;
  recovery_date: string;
  amount: number;
  city: string | null;
  route: string | null;
  remarks: string | null;
  parties?: { party_code: string; name_en: string } | null;
};

export type RecoveryListResult = {
  rows: RecoveryRow[];
  pagination: PaginationMeta;
  cityOptions: string[];
  sectorOptions: string[];
};

function distinctSorted(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = (raw || "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export async function fetchRecoveryList(
  supabase: SupabaseClient,
  companyId: string,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<RecoveryListResult> {
  const paginationParams = parsePaginationParams(searchParams);
  const { from, to } = toRange(paginationParams);
  const q = spString(searchParams, "q") || "";
  const city = spString(searchParams, "city") || "";
  const sector = spString(searchParams, "sector") || "";

  let query = supabase
    .from("recoveries")
    .select("*, parties(party_code, name_en)", { count: "exact" })
    .eq("company_id", companyId);

  if (city) query = query.eq("city", city);
  if (sector) query = query.eq("route", sector);

  const term = escapeIlike(q);
  if (term) {
    const pattern = `%${term}%`;
    query = query.or(
      [
        `recovery_date.ilike.${pattern}`,
        `city.ilike.${pattern}`,
        `route.ilike.${pattern}`,
        `remarks.ilike.${pattern}`,
        `parties.party_code.ilike.${pattern}`,
        `parties.name_en.ilike.${pattern}`,
      ].join(","),
    );
  }

  const [{ data, count, error }, locationRows] = await Promise.all([
    query
      .order("recovery_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to),
    supabase
      .from("recoveries")
      .select("city, route")
      .eq("company_id", companyId)
      .limit(5000),
  ]);

  if (error) throw new Error(error.message);

  return {
    rows: (data || []) as RecoveryRow[],
    pagination: buildPaginationMeta(count ?? 0, paginationParams),
    cityOptions: distinctSorted((locationRows.data || []).map((r) => r.city)),
    sectorOptions: distinctSorted((locationRows.data || []).map((r) => r.route)),
  };
}

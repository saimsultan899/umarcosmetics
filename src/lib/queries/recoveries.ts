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
  salesman_id: string | null;
  parties?: { party_code: string; name_en: string } | null;
  salesman?: { full_name: string | null } | null;
};

export type RecoveryListResult = {
  rows: RecoveryRow[];
  pagination: PaginationMeta;
  cityOptions: string[];
  sectorOptions: string[];
  salesmanOptions: { value: string; label: string }[];
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
  const salesmanId = spString(searchParams, "salesman") || "";

  let query = supabase
    .from("recoveries")
    .select(
      "*, parties(party_code, name_en), salesman:profiles!recoveries_salesman_id_fkey(full_name)",
      { count: "exact" },
    )
    .eq("company_id", companyId);

  if (city) query = query.eq("city", city);
  if (sector) query = query.eq("route", sector);
  if (salesmanId === "unassigned") query = query.is("salesman_id", null);
  else if (salesmanId) query = query.eq("salesman_id", salesmanId);

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

  const [{ data, count, error }, locationRows, rosterRes] = await Promise.all([
    query
      .order("recovery_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to),
    supabase
      .from("recoveries")
      .select("city, route")
      .eq("company_id", companyId)
      .limit(5000),
    supabase
      .from("company_members")
      .select("user_id, profiles(full_name)")
      .eq("company_id", companyId)
      .eq("role", "salesman")
      .eq("is_active", true),
  ]);

  if (error) throw new Error(error.message);

  const salesmanOptions = ((rosterRes.data || []) as Array<{
    user_id: string | null;
    profiles: { full_name: string | null } | { full_name: string | null }[] | null;
  }>)
    .map((m) => {
      const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      return {
        value: m.user_id || "",
        label: p?.full_name || "Salesman",
      };
    })
    .filter((o) => o.value)
    .sort((a, b) => a.label.localeCompare(b.label));
  salesmanOptions.push({ value: "unassigned", label: "Unassigned" });

  return {
    rows: (data || []) as RecoveryRow[],
    pagination: buildPaginationMeta(count ?? 0, paginationParams),
    cityOptions: distinctSorted((locationRows.data || []).map((r) => r.city)),
    sectorOptions: distinctSorted((locationRows.data || []).map((r) => r.route)),
    salesmanOptions,
  };
}

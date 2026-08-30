import {
  buildPaginationMeta,
  escapeIlike,
  parsePaginationParams,
  spString,
  toRange,
  type PaginationMeta,
} from "@/lib/pagination";
import {
  applyPartyLocationFilters,
  parsePartyLocationFilters,
  type PartyLocationFilters,
} from "@/lib/queries/party-filters";
import type { Party } from "@/lib/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PartySubtypeFilter =
  | "all"
  | "customer"
  | "supplier"
  | "both"
  | "other"
  | "credit";

export type PartyListStats = {
  total: number;
  customers: number;
  suppliers: number;
  withCreditLimit: number;
  subtypeMix: Array<{ name: string; value: number }>;
  cityBars: Array<{ name: string; value: number }>;
};

export type PartyListResult = {
  parties: Party[];
  pagination: PaginationMeta;
  stats: PartyListStats;
  cityOptions: string[];
  sectorOptions: string[];
  headOptions: string[];
};

function applySubtypeFilter(query: any, subtype: PartySubtypeFilter) {
  if (subtype === "credit") {
    return query.gt("credit_limit", 0);
  }
  if (subtype === "customer") {
    return query.in("party_subtype", ["customer", "both"]);
  }
  if (subtype === "supplier") {
    return query.in("party_subtype", ["supplier", "both"]);
  }
  if (subtype === "both") {
    return query.eq("party_subtype", "both");
  }
  if (subtype === "other") {
    return query.eq("party_subtype", "other");
  }
  return query;
}

function applySearch(query: any, q: string) {
  const term = escapeIlike(q);
  if (!term) return query;
  const pattern = `%${term}%`;
  return query.or(
    [
      `party_code.ilike.${pattern}`,
      `name_en.ilike.${pattern}`,
      `name_ur.ilike.${pattern}`,
      `city.ilike.${pattern}`,
      `route.ilike.${pattern}`,
      `head.ilike.${pattern}`,
      `mobile.ilike.${pattern}`,
      `phone.ilike.${pattern}`,
    ].join(","),
  );
}

function baseQuery(supabase: SupabaseClient, companyId: string) {
  return supabase
    .from("parties")
    .select("*", { count: "exact" })
    .eq("company_id", companyId)
    .eq("is_active", true);
}

async function countWithFilters(
  supabase: SupabaseClient,
  companyId: string,
  subtype: PartySubtypeFilter,
  q: string,
  location: PartyLocationFilters,
  extra?: (q: any) => any,
) {
  let query = baseQuery(supabase, companyId);
  query = applySubtypeFilter(query, subtype);
  query = applySearch(query, q);
  query = applyPartyLocationFilters(query, location);
  if (extra) query = extra(query);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function aggregateCities(rows: Array<{ city: string | null }>) {
  const cities = new Map<string, number>();
  for (const row of rows) {
    const key = row.city?.trim() || "No city";
    cities.set(key, (cities.get(key) || 0) + 1);
  }
  return [...cities.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
}

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

export async function fetchPartyList(
  supabase: SupabaseClient,
  companyId: string,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<PartyListResult> {
  const paginationParams = parsePaginationParams(searchParams);
  const { from, to } = toRange(paginationParams);
  const q = spString(searchParams, "q") || "";
  const subtype = (spString(searchParams, "type") ||
    "all") as PartySubtypeFilter;
  const location = parsePartyLocationFilters(searchParams);

  let listQuery = baseQuery(supabase, companyId);
  listQuery = applySubtypeFilter(listQuery, subtype);
  listQuery = applySearch(listQuery, q);
  listQuery = applyPartyLocationFilters(listQuery, location);

  const [
    { data, count, error },
    customers,
    suppliers,
    withCreditLimit,
    customerOnly,
    supplierOnly,
    bothCount,
    otherCount,
    cityRows,
    locationRows,
    savedLocations,
  ] = await Promise.all([
    listQuery.order("party_code", { ascending: true }).range(from, to),
    countWithFilters(supabase, companyId, "customer", q, location),
    countWithFilters(supabase, companyId, "supplier", q, location),
    countWithFilters(supabase, companyId, "credit", q, location),
    countWithFilters(supabase, companyId, "all", q, location, (qb) =>
      qb.eq("party_subtype", "customer"),
    ),
    countWithFilters(supabase, companyId, "all", q, location, (qb) =>
      qb.eq("party_subtype", "supplier"),
    ),
    countWithFilters(supabase, companyId, "all", q, location, (qb) =>
      qb.eq("party_subtype", "both"),
    ),
    countWithFilters(supabase, companyId, "all", q, location, (qb) =>
      qb.eq("party_subtype", "other"),
    ),
    (async () => {
      let query = supabase
        .from("parties")
        .select("city")
        .eq("company_id", companyId)
        .eq("is_active", true);
      query = applySubtypeFilter(query, subtype);
      query = applySearch(query, q);
      query = applyPartyLocationFilters(query, location);
      return query.limit(5000);
    })(),
    supabase
      .from("parties")
      .select("city, route, head")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .limit(5000),
    supabase
      .from("company_locations")
      .select("kind, name")
      .eq("company_id", companyId),
  ]);

  if (error) throw new Error(error.message);

  const total = count ?? 0;
  const meta = buildPaginationMeta(total, paginationParams);
  const cityData = cityRows.data || [];

  const subtypeMix = [
    { name: "Customers", value: customerOnly },
    { name: "Vendors", value: supplierOnly },
    { name: "Both", value: bothCount },
    { name: "Other", value: otherCount },
  ].filter((x) => x.value > 0);

  return {
    parties: (data || []) as Party[],
    pagination: meta,
    stats: {
      total,
      customers,
      suppliers,
      withCreditLimit,
      subtypeMix,
      cityBars: aggregateCities(cityData),
    },
    cityOptions: distinctSorted([
      ...(locationRows.data || []).map((r) => r.city),
      ...((savedLocations.data || []) as Array<{ kind: string; name: string }>)
        .filter((r) => r.kind === "city")
        .map((r) => r.name),
    ]),
    sectorOptions: distinctSorted([
      ...(locationRows.data || []).map((r) => r.route),
      ...((savedLocations.data || []) as Array<{ kind: string; name: string }>)
        .filter((r) => r.kind === "sector")
        .map((r) => r.name),
    ]),
    headOptions: [],
  };
}

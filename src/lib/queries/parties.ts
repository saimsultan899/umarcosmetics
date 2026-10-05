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
import type { Party, PartyType } from "@/lib/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PartySubtypeFilter =
  | "all"
  | "customer"
  | "supplier"
  | "both"
  | "other"
  | "credit";

export type PartyViewFilter = "all" | "ledger" | "trading";

const LEDGER_TYPES: PartyType[] = ["ASSETS", "CAPITAL", "EXPENSES", "INCOME"];

export type PartyListStats = {
  total: number;
  customers: number;
  suppliers: number;
  withCreditLimit: number;
  subtypeMix: Array<{ name: string; value: number }>;
  ledgerMix: Array<{ name: string; value: number }>;
  cityBars: Array<{ name: string; value: number }>;
  mode: PartyViewFilter;
};

export type PartyListResult = {
  parties: Party[];
  pagination: PaginationMeta;
  stats: PartyListStats;
  cityOptions: string[];
  sectorOptions: string[];
  headOptions: string[];
};

function applyViewFilter(query: any, view: PartyViewFilter) {
  if (view === "ledger") {
    return query.in("party_type", LEDGER_TYPES);
  }
  if (view === "trading") {
    return query.eq("party_type", "PARTY");
  }
  return query;
}

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
    .eq("company_id", companyId);
}

type PartyStatRow = {
  party_type: PartyType | null;
  party_subtype: string | null;
  credit_limit: number | null;
  city: string | null;
  route: string | null;
  head: string | null;
  party_code: string | null;
  name_en: string | null;
  name_ur: string | null;
  mobile: string | null;
  phone: string | null;
};

function matchesPartySearch(row: PartyStatRow, q: string) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [
    row.party_code,
    row.name_en,
    row.name_ur,
    row.city,
    row.route,
    row.head,
    row.mobile,
    row.phone,
  ].some((value) => (value || "").toLowerCase().includes(needle));
}

function matchesPartyLocation(row: PartyStatRow, location: PartyLocationFilters) {
  if (location.city && row.city !== location.city) return false;
  if (location.sector && row.route !== location.sector) return false;
  if (location.head && row.head !== location.head) return false;
  return true;
}

function matchesPartyView(row: PartyStatRow, view: PartyViewFilter) {
  if (view === "ledger") return LEDGER_TYPES.includes(row.party_type as PartyType);
  if (view === "trading") return row.party_type === "PARTY";
  return true;
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

/** Every party matching the list filters, for PDF and print. */
export async function fetchPartiesForExport(
  supabase: SupabaseClient,
  companyId: string,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<Party[]> {
  const q = spString(searchParams, "q") || "";
  const rawView = spString(searchParams, "view");
  const view: PartyViewFilter =
    rawView === "ledger" || rawView === "trading" ? rawView : "all";
  const subtype = (view === "ledger"
    ? "all"
    : spString(searchParams, "type") || "all") as PartySubtypeFilter;
  const location = parsePartyLocationFilters(searchParams);

  let query = supabase.from("parties").select("*").eq("company_id", companyId);
  query = applyViewFilter(query, view);
  query = applySubtypeFilter(query, subtype);
  query = applySearch(query, q);
  query = applyPartyLocationFilters(query, location);

  const { data, error } = await query
    .order("party_code", { ascending: true })
    .limit(10000);
  if (error) throw new Error(error.message);
  return (data || []) as Party[];
}

export async function fetchPartyList(
  supabase: SupabaseClient,
  companyId: string,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<PartyListResult> {
  const paginationParams = parsePaginationParams(searchParams);
  const { from, to } = toRange(paginationParams);
  const q = spString(searchParams, "q") || "";
  const rawView = spString(searchParams, "view");
  const view: PartyViewFilter =
    rawView === "ledger" || rawView === "trading" ? rawView : "all";
  const subtype = (view === "ledger"
    ? "all"
    : spString(searchParams, "type") || "all") as PartySubtypeFilter;
  const location = parsePartyLocationFilters(searchParams);

  let listQuery = baseQuery(supabase, companyId);
  listQuery = applyViewFilter(listQuery, view);
  listQuery = applySubtypeFilter(listQuery, subtype);
  listQuery = applySearch(listQuery, q);
  listQuery = applyPartyLocationFilters(listQuery, location);

  const [{ data, count, error }, slim, savedLocations] = await Promise.all([
    listQuery.order("party_code", { ascending: true }).range(from, to),
    supabase
      .from("parties")
      .select(
        "party_type, party_subtype, credit_limit, city, route, head, party_code, name_en, name_ur, mobile, phone",
      )
      .eq("company_id", companyId)
      .eq("is_active", true)
      .limit(20000),
    supabase
      .from("company_locations")
      .select("kind, name")
      .eq("company_id", companyId),
  ]);

  if (error) throw new Error(error.message);
  if (slim.error) throw new Error(slim.error.message);

  const activeRows = (slim.data || []) as PartyStatRow[];
  const inView = (row: PartyStatRow, nextView: PartyViewFilter = view) =>
    matchesPartyView(row, nextView) &&
    matchesPartySearch(row, q) &&
    matchesPartyLocation(row, location);
  const filtered = activeRows.filter((row) => inView(row));
  const customers = filtered.filter((row) =>
    row.party_subtype === "customer" || row.party_subtype === "both",
  ).length;
  const suppliers = filtered.filter((row) =>
    row.party_subtype === "supplier" || row.party_subtype === "both",
  ).length;
  const withCreditLimit = filtered.filter(
    (row) => Number(row.credit_limit) > 0,
  ).length;
  const customerOnly = filtered.filter((row) => row.party_subtype === "customer").length;
  const supplierOnly = filtered.filter((row) => row.party_subtype === "supplier").length;
  const bothCount = filtered.filter((row) => row.party_subtype === "both").length;
  const otherCount = filtered.filter((row) => row.party_subtype === "other").length;
  const ledgerRows = activeRows.filter(
    (row) =>
      matchesPartyView(row, "ledger") &&
      matchesPartySearch(row, q) &&
      matchesPartyLocation(row, location),
  );
  const assetsCount = ledgerRows.filter((row) => row.party_type === "ASSETS").length;
  const capitalCount = ledgerRows.filter((row) => row.party_type === "CAPITAL").length;
  const expensesCount = ledgerRows.filter((row) => row.party_type === "EXPENSES").length;
  const incomeCount = ledgerRows.filter((row) => row.party_type === "INCOME").length;
  const cityData = filtered.filter((row) => {
    if (subtype === "credit") return Number(row.credit_limit) > 0;
    if (subtype === "customer") {
      return row.party_subtype === "customer" || row.party_subtype === "both";
    }
    if (subtype === "supplier") {
      return row.party_subtype === "supplier" || row.party_subtype === "both";
    }
    if (subtype === "both" || subtype === "other") return row.party_subtype === subtype;
    return true;
  });

  const total = count ?? 0;
  const meta = buildPaginationMeta(total, paginationParams);

  const subtypeMix = [
    { name: "Customers", value: customerOnly },
    { name: "Vendors", value: supplierOnly },
    { name: "Both", value: bothCount },
    { name: "Other", value: otherCount },
  ].filter((x) => x.value > 0);

  const ledgerMix = [
    { name: "Assets", value: assetsCount },
    { name: "Capital", value: capitalCount },
    { name: "Expenses", value: expensesCount },
    { name: "Income", value: incomeCount },
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
      ledgerMix,
      cityBars: aggregateCities(cityData),
      mode: view,
    },
    cityOptions: distinctSorted([
      ...activeRows.map((r) => r.city),
      ...((savedLocations.data || []) as Array<{ kind: string; name: string }>)
        .filter((r) => r.kind === "city")
        .map((r) => r.name),
    ]),
    sectorOptions: distinctSorted([
      ...activeRows.map((r) => r.route),
      ...((savedLocations.data || []) as Array<{ kind: string; name: string }>)
        .filter((r) => r.kind === "sector")
        .map((r) => r.name),
    ]),
    headOptions: [],
  };
}

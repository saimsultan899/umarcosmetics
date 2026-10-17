import { localDateIso } from "@/lib/dates";
import {
  buildPaginationMeta,
  escapeIlike,
  parsePaginationParams,
  spString,
  toRange,
  type PaginationMeta,
} from "@/lib/pagination";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import type { SupabaseClient } from "@supabase/supabase-js";

export type RecoveryRow = {
  id: string;
  recovery_date: string;
  amount: number;
  /** Current shop receivable after collections (Dr balance). */
  remaining: number | null;
  city: string | null;
  route: string | null;
  remarks: string | null;
  salesman_id: string | null;
  party_id?: string | null;
  parties?: {
    party_code: string;
    name_en: string;
    head?: string | null;
    route?: string | null;
    city?: string | null;
  } | null;
  salesman?: { full_name: string | null } | null;
};

export type RecoveryListResult = {
  rows: RecoveryRow[];
  pagination: PaginationMeta;
  cityOptions: string[];
  sectorOptions: string[];
  headOptions: string[];
  salesmanOptions: { value: string; label: string }[];
  /** Sum of recovery amounts for the current filter (all pages). */
  amountTotal: number;
  /** Sum of current remaining for unique shops in the current filter. */
  remainingTotal: number;
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

function isoDateParam(value: string | undefined) {
  const raw = (value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function quoteOrValue(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

async function partyIdsMatching(
  supabase: SupabaseClient,
  companyId: string,
  opts: { term?: string; head?: string; city?: string; sector?: string },
) {
  let query = supabase.from("parties").select("id").eq("company_id", companyId);
  if (opts.head) query = query.eq("head", opts.head);
  if (opts.city) query = query.eq("city", opts.city);
  if (opts.sector) query = query.eq("route", opts.sector);
  if (opts.term) {
    const pattern = quoteOrValue(`%${opts.term}%`);
    query = query.or(
      `party_code.ilike.${pattern},name_en.ilike.${pattern},route.ilike.${pattern},city.ilike.${pattern},head.ilike.${pattern}`,
    );
  }
  const { data, error } = await query.limit(8000);
  if (error) throw new Error(error.message);
  return (data || []).map((row) => String(row.id));
}

function applyDateRange(query: any, fromDate: string, toDate: string) {
  let from = fromDate;
  let to = toDate;
  if (from && to && from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  if (from) query = query.gte("recovery_date", from);
  if (to) query = query.lte("recovery_date", to);
  return query;
}

type FilterState = {
  city: string;
  sector: string;
  head: string;
  salesmanId: string;
  partyId: string;
  fromDate: string;
  toDate: string;
  term: string;
};

function readFilters(
  searchParams: Record<string, string | string[] | undefined>,
): FilterState {
  return {
    city: spString(searchParams, "city") || "",
    sector: spString(searchParams, "sector") || "",
    head: (spString(searchParams, "head") || "").trim(),
    salesmanId: spString(searchParams, "salesman") || "",
    partyId: spString(searchParams, "party") || "",
    fromDate: isoDateParam(spString(searchParams, "fromDate")),
    toDate: isoDateParam(spString(searchParams, "toDate")),
    term: escapeIlike(spString(searchParams, "q") || ""),
  };
}

async function resolvePartyIds(
  supabase: SupabaseClient,
  companyId: string,
  filters: FilterState,
): Promise<string[] | null> {
  const { partyId, term, head, city, sector } = filters;
  if (partyId) return [partyId];

  const needsPartyLookup = Boolean(term || head || city || sector);
  if (!needsPartyLookup) return null;

  return partyIdsMatching(supabase, companyId, {
    term: term || undefined,
    head: head || undefined,
    city: city || undefined,
    sector: sector || undefined,
  });
}

function applyRecoveryFilters(
  query: any,
  companyId: string,
  filters: FilterState,
  partyIds: string[] | null,
) {
  query = query.eq("company_id", companyId);

  if (filters.salesmanId === "unassigned") {
    query = query.is("salesman_id", null);
  } else if (filters.salesmanId) {
    query = query.eq("salesman_id", filters.salesmanId);
  }
  query = applyDateRange(query, filters.fromDate, filters.toDate);

  if (partyIds) {
    if (partyIds.length === 0) {
      return query.eq("party_id", "00000000-0000-0000-0000-000000000000");
    }
    if (filters.term && !filters.partyId) {
      const pattern = `%${filters.term}%`;
      const parts = [
        `remarks.ilike.${pattern}`,
        `city.ilike.${pattern}`,
        `route.ilike.${pattern}`,
        `party_id.in.(${partyIds.join(",")})`,
      ];
      return query.or(parts.join(","));
    }
    return query.in("party_id", partyIds);
  }

  return query;
}

async function fetchFilterOptions(
  supabase: SupabaseClient,
  companyId: string,
): Promise<{
  cityOptions: string[];
  sectorOptions: string[];
  headOptions: string[];
  salesmanOptions: { value: string; label: string }[];
}> {
  const [partyRows, rosterRes, usedSalesmen] = await Promise.all([
    fetchAllPages<{
      city: string | null;
      route: string | null;
      head: string | null;
    }>((fromPage, toPage) =>
      supabase
        .from("parties")
        .select("city, route, head")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("id")
        .range(fromPage, toPage),
    ),
    supabase
      .from("salesmen")
      .select("id, full_name, is_active")
      .eq("company_id", companyId)
      .order("full_name"),
    supabase
      .from("recoveries")
      .select("salesman_id, salesman:salesmen!recoveries_salesman_id_fkey(id, full_name)")
      .eq("company_id", companyId)
      .not("salesman_id", "is", null)
      .limit(2000),
  ]);

  const byId = new Map<string, string>();
  for (const m of (rosterRes.data || []) as Array<{
    id: string | null;
    full_name: string | null;
  }>) {
    if (!m.id) continue;
    byId.set(m.id, m.full_name || "Salesman");
  }
  for (const row of (usedSalesmen.data || []) as Array<{
    salesman_id: string | null;
    salesman:
      | { id?: string; full_name?: string | null }
      | Array<{ id?: string; full_name?: string | null }>
      | null;
  }>) {
    const sm = Array.isArray(row.salesman) ? row.salesman[0] : row.salesman;
    const id = String(sm?.id || row.salesman_id || "");
    if (!id || byId.has(id)) continue;
    byId.set(id, sm?.full_name || "Salesman");
  }

  const salesmanOptions = [...byId.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  salesmanOptions.push({ value: "unassigned", label: "Unassigned" });

  return {
    cityOptions: distinctSorted(partyRows.map((r) => r.city)),
    sectorOptions: distinctSorted(partyRows.map((r) => r.route)),
    headOptions: distinctSorted(partyRows.map((r) => r.head)),
    salesmanOptions,
  };
}

async function fetchPartyBalances(
  supabase: SupabaseClient,
  companyId: string,
  partyIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const unique = [...new Set(partyIds.filter(Boolean))];
  if (!unique.length) return map;

  const { data, error } = await supabase.rpc("get_recovery_sheet", {
    p_company_id: companyId,
    p_as_of: localDateIso(),
  });
  if (error) throw new Error(error.message);

  const wanted = new Set(unique);
  for (const row of (data || []) as Array<{
    party_id: string;
    balance: number | string;
  }>) {
    const id = String(row.party_id);
    if (!wanted.has(id)) continue;
    map.set(id, Number(row.balance || 0));
  }

  // Parties missing from the sheet (inactive / non-customer) — fall back to RPC.
  const missing = unique.filter((id) => !map.has(id));
  if (missing.length) {
    await Promise.all(
      missing.map(async (id) => {
        const { data: bal } = await supabase.rpc("get_party_balance", {
          p_company_id: companyId,
          p_party_id: id,
          p_as_of: localDateIso(),
        });
        map.set(id, Number(bal || 0));
      }),
    );
  }

  return map;
}

function mapRecoveryRow(
  row: Record<string, unknown>,
  remainingByParty: Map<string, number>,
): RecoveryRow {
  const partyRaw = row.parties;
  const party = Array.isArray(partyRaw) ? partyRaw[0] : partyRaw;
  const salesmanRaw = row.salesman;
  const salesman = Array.isArray(salesmanRaw) ? salesmanRaw[0] : salesmanRaw;
  const partyObj = party as RecoveryRow["parties"];
  const salesmanObj = salesman as RecoveryRow["salesman"];
  const partyId = row.party_id ? String(row.party_id) : null;
  return {
    id: String(row.id),
    recovery_date: String(row.recovery_date || ""),
    amount: Number(row.amount || 0),
    remaining: partyId
      ? (remainingByParty.get(partyId) ?? null)
      : null,
    city:
      (row.city as string | null) ??
      (partyObj?.city as string | null) ??
      null,
    route:
      (row.route as string | null) ??
      (partyObj?.route as string | null) ??
      null,
    remarks: (row.remarks as string | null) ?? null,
    salesman_id: (row.salesman_id as string | null) ?? null,
    party_id: partyId,
    parties: partyObj
      ? {
          party_code: String(partyObj.party_code || ""),
          name_en: String(partyObj.name_en || ""),
          head: partyObj.head ?? null,
          route: partyObj.route ?? null,
          city: partyObj.city ?? null,
        }
      : null,
    salesman: salesmanObj
      ? { full_name: salesmanObj.full_name ?? null }
      : null,
  };
}

export async function fetchRecoveryList(
  supabase: SupabaseClient,
  companyId: string,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<RecoveryListResult> {
  const paginationParams = parsePaginationParams(searchParams);
  const { from, to } = toRange(paginationParams);
  const filters = readFilters(searchParams);
  const partyIds = await resolvePartyIds(supabase, companyId, filters);

  let query = supabase
    .from("recoveries")
    .select(
      "id, recovery_date, amount, city, route, remarks, salesman_id, party_id, created_at, parties(party_code, name_en, head, route, city), salesman:salesmen!recoveries_salesman_id_fkey(full_name)",
      { count: "exact" },
    );
  query = applyRecoveryFilters(query, companyId, filters, partyIds);

  const [{ data, count, error }, filterOptions, amountPartyRows] =
    await Promise.all([
      query
        .order("recovery_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, to),
      fetchFilterOptions(supabase, companyId),
      fetchAllPages<{ amount: number; party_id: string | null }>(
        (fromPage, toPage) => {
          let sumQuery = supabase
            .from("recoveries")
            .select("amount, party_id")
            .order("id");
          sumQuery = applyRecoveryFilters(
            sumQuery,
            companyId,
            filters,
            partyIds,
          );
          return sumQuery.range(fromPage, toPage);
        },
      ),
    ]);

  if (error) throw new Error(error.message);

  const pagePartyIds = ((data || []) as Array<{ party_id?: string | null }>)
    .map((r) => (r.party_id ? String(r.party_id) : ""))
    .filter(Boolean);
  const filteredPartyIds = [
    ...new Set(
      amountPartyRows
        .map((r) => (r.party_id ? String(r.party_id) : ""))
        .filter(Boolean),
    ),
  ];

  const remainingByParty = await fetchPartyBalances(
    supabase,
    companyId,
    [...new Set([...pagePartyIds, ...filteredPartyIds])],
  );

  const rows: RecoveryRow[] = (
    (data || []) as unknown as Array<Record<string, unknown>>
  ).map((row) => mapRecoveryRow(row, remainingByParty));

  const amountTotal = amountPartyRows.reduce(
    (sum, r) => sum + Number(r.amount || 0),
    0,
  );
  const remainingTotal = filteredPartyIds.reduce(
    (sum, id) => sum + Number(remainingByParty.get(id) || 0),
    0,
  );

  return {
    rows,
    pagination: buildPaginationMeta(count ?? 0, paginationParams),
    cityOptions: filterOptions.cityOptions,
    sectorOptions: filterOptions.sectorOptions,
    headOptions: filterOptions.headOptions,
    salesmanOptions: filterOptions.salesmanOptions,
    amountTotal,
    remainingTotal,
  };
}

/** All matching recoveries for Excel / PDF / print. */
export async function fetchRecoveriesForExport(
  supabase: SupabaseClient,
  companyId: string,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<Record<string, unknown>[]> {
  const filters = readFilters(searchParams);
  const partyIds = await resolvePartyIds(supabase, companyId, filters);

  type ExportRow = {
    recovery_date: string;
    amount: number;
    city: string | null;
    route: string | null;
    remarks: string | null;
    salesman_id: string | null;
    party_id: string | null;
    parties:
      | {
          party_code?: string;
          name_en?: string;
          head?: string | null;
          city?: string | null;
          route?: string | null;
        }
      | Array<{
          party_code?: string;
          name_en?: string;
          head?: string | null;
          city?: string | null;
          route?: string | null;
        }>
      | null;
    salesman:
      | { full_name: string | null }
      | Array<{ full_name: string | null }>
      | null;
  };

  const rows = await fetchAllPages<ExportRow>((from, to) => {
    let query = supabase
      .from("recoveries")
      .select(
        "recovery_date, amount, city, route, remarks, salesman_id, party_id, parties(party_code, name_en, head, city, route), salesman:salesmen!recoveries_salesman_id_fkey(full_name)",
      );
    query = applyRecoveryFilters(query, companyId, filters, partyIds);
    return query
      .order("recovery_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);
  });

  const remainingByParty = await fetchPartyBalances(
    supabase,
    companyId,
    rows.map((r) => String(r.party_id || "")).filter(Boolean),
  );

  const mapped = rows.map((r) => {
    const party = Array.isArray(r.parties) ? r.parties[0] : r.parties;
    const salesman = Array.isArray(r.salesman) ? r.salesman[0] : r.salesman;
    const partyId = r.party_id ? String(r.party_id) : "";
    return {
      Date: r.recovery_date,
      Code: party?.party_code || "",
      Customer: party?.name_en || "",
      Head: party?.head || "",
      City: r.city || party?.city || "",
      Sector: r.route || party?.route || "",
      Salesman: salesman?.full_name || (r.salesman_id ? "" : "Unassigned"),
      Amount: Number(r.amount || 0),
      Remaining: partyId ? Number(remainingByParty.get(partyId) || 0) : "",
      Remarks: r.remarks || "",
    };
  });

  if (mapped.length) {
    const amountTotal = mapped.reduce(
      (sum, r) => sum + Number(r.Amount || 0),
      0,
    );
    const uniqueParties = [
      ...new Set(rows.map((r) => String(r.party_id || "")).filter(Boolean)),
    ];
    const remainingTotal = uniqueParties.reduce(
      (sum, id) => sum + Number(remainingByParty.get(id) || 0),
      0,
    );
    mapped.push({
      Date: "",
      Code: "",
      Customer: "TOTAL",
      Head: "",
      City: "",
      Sector: "",
      Salesman: "",
      Amount: amountTotal,
      Remaining: remainingTotal,
      Remarks: "",
    });
  }

  return mapped;
}

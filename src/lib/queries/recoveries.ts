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
  city: string | null;
  route: string | null;
  remarks: string | null;
  salesman_id: string | null;
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
  opts: { term?: string; head?: string },
) {
  let query = supabase.from("parties").select("id").eq("company_id", companyId);
  if (opts.head) query = query.eq("head", opts.head);
  if (opts.term) {
    const pattern = quoteOrValue(`%${opts.term}%`);
    query = query.or(
      `party_code.ilike.${pattern},name_en.ilike.${pattern},route.ilike.${pattern},city.ilike.${pattern},head.ilike.${pattern}`,
    );
  }
  const { data, error } = await query.limit(5000);
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
  const head = (spString(searchParams, "head") || "").trim();
  const salesmanId = spString(searchParams, "salesman") || "";
  const partyId = spString(searchParams, "party") || "";
  const fromDate = isoDateParam(spString(searchParams, "fromDate"));
  const toDate = isoDateParam(spString(searchParams, "toDate"));

  const term = escapeIlike(q);
  let partyIds: string[] | null = null;
  if (partyId) {
    partyIds = [partyId];
  } else if (term || head) {
    partyIds = await partyIdsMatching(supabase, companyId, {
      term: term || undefined,
      head: head || undefined,
    });
  }

  let query = supabase
    .from("recoveries")
    .select(
      "id, recovery_date, amount, city, route, remarks, salesman_id, party_id, created_at, parties(party_code, name_en, head, route, city), salesman:salesmen!recoveries_salesman_id_fkey(full_name)",
      { count: "exact" },
    )
    .eq("company_id", companyId);

  if (city) query = query.eq("city", city);
  if (sector) query = query.eq("route", sector);
  if (salesmanId === "unassigned") query = query.is("salesman_id", null);
  else if (salesmanId) query = query.eq("salesman_id", salesmanId);
  query = applyDateRange(query, fromDate, toDate);

  if (partyIds) {
    if (partyIds.length === 0) {
      query = query.eq("party_id", "00000000-0000-0000-0000-000000000000");
    } else if (term && !partyId) {
      // Match party fields OR recovery text fields.
      const pattern = `%${term}%`;
      const partyOr =
        partyIds.length > 0
          ? `party_id.in.(${partyIds.join(",")})`
          : null;
      const parts = [
        `remarks.ilike.${pattern}`,
        `city.ilike.${pattern}`,
        `route.ilike.${pattern}`,
        ...(partyOr ? [partyOr] : []),
      ];
      query = query.or(parts.join(","));
    } else {
      query = query.in("party_id", partyIds);
    }
  }

  const [{ data, count, error }, locationRows, headRows, rosterRes] =
    await Promise.all([
      query
        .order("recovery_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, to),
      fetchAllPages<{ city: string | null; route: string | null }>(
        (fromPage, toPage) =>
          supabase
            .from("recoveries")
            .select("city, route")
            .eq("company_id", companyId)
            .order("id")
            .range(fromPage, toPage),
      ),
      supabase
        .from("parties")
        .select("head")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .not("head", "is", null)
        .limit(5000),
      supabase
        .from("salesmen")
        .select("id, full_name")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("full_name"),
    ]);

  if (error) throw new Error(error.message);

  const salesmanOptions = ((rosterRes.data || []) as Array<{
    id: string | null;
    full_name: string | null;
  }>)
    .map((m) => ({
      value: m.id || "",
      label: m.full_name || "Salesman",
    }))
    .filter((o) => o.value)
    .sort((a, b) => a.label.localeCompare(b.label));
  salesmanOptions.push({ value: "unassigned", label: "Unassigned" });

  const rows: RecoveryRow[] = ((data || []) as unknown as Array<Record<string, unknown>>).map((row) => {
    const partyRaw = row.parties;
    const party = Array.isArray(partyRaw) ? partyRaw[0] : partyRaw;
    const salesmanRaw = row.salesman;
    const salesman = Array.isArray(salesmanRaw) ? salesmanRaw[0] : salesmanRaw;
    const partyObj = party as RecoveryRow["parties"];
    const salesmanObj = salesman as RecoveryRow["salesman"];
    return {
      id: String(row.id),
      recovery_date: String(row.recovery_date || ""),
      amount: Number(row.amount || 0),
      city: (row.city as string | null) ?? null,
      route: (row.route as string | null) ?? null,
      remarks: (row.remarks as string | null) ?? null,
      salesman_id: (row.salesman_id as string | null) ?? null,
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
  });

  return {
    rows,
    pagination: buildPaginationMeta(count ?? 0, paginationParams),
    cityOptions: distinctSorted(locationRows.map((r) => r.city)),
    sectorOptions: distinctSorted(locationRows.map((r) => r.route)),
    headOptions: distinctSorted(
      ((headRows.data || []) as Array<{ head: string | null }>).map(
        (r) => r.head,
      ),
    ),
    salesmanOptions,
  };
}

/** All matching recoveries for Excel / PDF / print. */
export async function fetchRecoveriesForExport(
  supabase: SupabaseClient,
  companyId: string,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<Record<string, unknown>[]> {
  const city = spString(searchParams, "city") || "";
  const sector = spString(searchParams, "sector") || "";
  const head = (spString(searchParams, "head") || "").trim();
  const salesmanId = spString(searchParams, "salesman") || "";
  const partyId = spString(searchParams, "party") || "";
  const fromDate = isoDateParam(spString(searchParams, "fromDate"));
  const toDate = isoDateParam(spString(searchParams, "toDate"));
  const q = spString(searchParams, "q") || "";
  const term = escapeIlike(q);

  let partyIds: string[] | null = null;
  if (partyId) partyIds = [partyId];
  else if (term || head) {
    partyIds = await partyIdsMatching(supabase, companyId, {
      term: term || undefined,
      head: head || undefined,
    });
  }

  type ExportRow = {
    recovery_date: string;
    amount: number;
    city: string | null;
    route: string | null;
    remarks: string | null;
    salesman_id: string | null;
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
    salesman: { full_name: string | null } | Array<{ full_name: string | null }> | null;
  };

  const rows = await fetchAllPages<ExportRow>((from, to) => {
    let query = supabase
      .from("recoveries")
      .select(
        "recovery_date, amount, city, route, remarks, salesman_id, parties(party_code, name_en, head, city, route), salesman:salesmen!recoveries_salesman_id_fkey(full_name)",
      )
      .eq("company_id", companyId);
    if (city) query = query.eq("city", city);
    if (sector) query = query.eq("route", sector);
    if (salesmanId === "unassigned") query = query.is("salesman_id", null);
    else if (salesmanId) query = query.eq("salesman_id", salesmanId);
    query = applyDateRange(query, fromDate, toDate);
    if (partyIds) {
      if (!partyIds.length) {
        query = query.eq("party_id", "00000000-0000-0000-0000-000000000000");
      } else {
        query = query.in("party_id", partyIds);
      }
    }
    return query
      .order("recovery_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);
  });

  return rows.map((r) => {
    const party = Array.isArray(r.parties) ? r.parties[0] : r.parties;
    const salesman = Array.isArray(r.salesman) ? r.salesman[0] : r.salesman;
    return {
      Date: r.recovery_date,
      Code: party?.party_code || "",
      Customer: party?.name_en || "",
      Head: party?.head || "",
      City: r.city || party?.city || "",
      Sector: r.route || party?.route || "",
      Salesman: salesman?.full_name || (r.salesman_id ? "" : "Unassigned"),
      Amount: Number(r.amount || 0),
      Remarks: r.remarks || "",
    };
  });
}

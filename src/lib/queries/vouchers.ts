import {
  buildPaginationMeta,
  escapeIlike,
  parsePaginationParams,
  spString,
  toRange,
  type PaginationMeta,
} from "@/lib/pagination";
import type { SupabaseClient } from "@supabase/supabase-js";

export type VoucherRow = {
  id: string;
  voucher_no: string;
  voucher_date: string;
  total_amount: number;
  narration: string | null;
  /** Customers on the voucher (cash receipt list). */
  partyLabel?: string;
  /** Distinct shop sectors on those customers. */
  sectorLabel?: string;
};

export type VoucherListResult = {
  vouchers: VoucherRow[];
  pagination: PaginationMeta;
};

function quoteOrValue(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

type LineParty = {
  party_code?: string | null;
  name_en?: string | null;
  route?: string | null;
};

function partyLabels(
  lines: Array<{ parties?: LineParty | LineParty[] | null }> | null | undefined,
) {
  const names: string[] = [];
  const sectors = new Set<string>();
  for (const line of lines || []) {
    const party = Array.isArray(line.parties) ? line.parties[0] : line.parties;
    if (!party) continue;
    const label = [party.party_code, party.name_en].filter(Boolean).join(" — ");
    if (label && !names.includes(label)) names.push(label);
    const route = String(party.route || "").trim();
    if (route) sectors.add(route);
  }
  return {
    partyLabel: names.join(", ") || undefined,
    sectorLabel: [...sectors].join(", ") || undefined,
  };
}

function isoDateParam(value: string | undefined) {
  const raw = (value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function applyVoucherDateRange(query: any, fromDate: string, toDate: string) {
  let from = fromDate;
  let to = toDate;
  if (from && to && from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  if (from) query = query.gte("voucher_date", from);
  if (to) query = query.lte("voucher_date", to);
  return query;
}

export async function fetchVoucherList(
  supabase: SupabaseClient,
  companyId: string,
  searchParams: Record<string, string | string[] | undefined>,
  voucherType: "CR" | "CP" | "JV",
): Promise<VoucherListResult> {
  const paginationParams = parsePaginationParams(searchParams);
  const { from, to } = toRange(paginationParams);
  const q = spString(searchParams, "q") || "";
  const sector = (spString(searchParams, "sector") || "").trim();
  const fromDate = isoDateParam(spString(searchParams, "fromDate"));
  const toDate = isoDateParam(spString(searchParams, "toDate"));

  const term = escapeIlike(q);
  let restrictIds: string[] | null = null;

  if (term || sector) {
    async function voucherIdsForParties(partyIds: string[]) {
      const ids = new Set<string>();
      if (!partyIds.length) return ids;
      const { data: lineHits, error: lineErr } = await supabase
        .from("voucher_lines")
        .select("voucher_id")
        .eq("company_id", companyId)
        .in("party_id", partyIds)
        .limit(10000);
      if (lineErr) throw new Error(lineErr.message);
      for (const row of lineHits || []) {
        if (row.voucher_id) ids.add(String(row.voucher_id));
      }
      return ids;
    }

    let sectorVoucherIds: Set<string> | null = null;
    if (sector) {
      const { data: sectorParties, error: sectorErr } = await supabase
        .from("parties")
        .select("id")
        .eq("company_id", companyId)
        .eq("route", sector)
        .limit(5000);
      if (sectorErr) throw new Error(sectorErr.message);
      sectorVoucherIds = await voucherIdsForParties(
        (sectorParties || []).map((row) => String(row.id)),
      );
    }

    const matched = new Set<string>();
    if (term) {
      let partyQuery = supabase
        .from("parties")
        .select("id")
        .eq("company_id", companyId);
      if (sector) partyQuery = partyQuery.eq("route", sector);
      const pattern = quoteOrValue(`%${term}%`);
      partyQuery = partyQuery.or(
        `party_code.ilike.${pattern},name_en.ilike.${pattern},route.ilike.${pattern}`,
      );
      const { data: partyHits, error: partyErr } = await partyQuery.limit(5000);
      if (partyErr) throw new Error(partyErr.message);
      const fromParties = await voucherIdsForParties(
        (partyHits || []).map((row) => String(row.id)),
      );
      for (const id of fromParties) matched.add(id);

      const textPattern = `%${term}%`;
      const { data: textHits, error: textErr } = await supabase
        .from("vouchers")
        .select("id")
        .eq("company_id", companyId)
        .eq("voucher_type", voucherType)
        .neq("status", "cancelled")
        .or(`voucher_no.ilike.${textPattern},narration.ilike.${textPattern}`)
        .limit(2000);
      if (textErr) throw new Error(textErr.message);
      for (const row of textHits || []) {
        const id = String(row.id);
        if (sectorVoucherIds && !sectorVoucherIds.has(id)) continue;
        matched.add(id);
      }
    }

    restrictIds = [
      ...(term ? matched : sectorVoucherIds || new Set<string>()),
    ];
  }

  let query = supabase
    .from("vouchers")
    .select(
      "id, voucher_no, voucher_date, total_amount, narration, voucher_lines(party_id, parties(party_code, name_en, route))",
      { count: "exact" },
    )
    .eq("company_id", companyId)
    .eq("voucher_type", voucherType)
    .neq("status", "cancelled");

  query = applyVoucherDateRange(query, fromDate, toDate);

  if (restrictIds) {
    if (restrictIds.length === 0) {
      query = query.eq("id", "00000000-0000-0000-0000-000000000000");
    } else {
      query = query.in("id", restrictIds);
    }
  }

  const { data, count, error } = await query
    .order("voucher_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(error.message);

  const vouchers: VoucherRow[] = (data || []).map((row) => {
    const record = row as {
      id: string;
      voucher_no: string;
      voucher_date: string;
      total_amount: number;
      narration: string | null;
      voucher_lines?: Array<{ parties?: LineParty | LineParty[] | null }>;
    };
    const labels = partyLabels(record.voucher_lines);
    return {
      id: record.id,
      voucher_no: record.voucher_no,
      voucher_date: record.voucher_date,
      total_amount: Number(record.total_amount || 0),
      narration: record.narration,
      partyLabel: labels.partyLabel,
      sectorLabel: labels.sectorLabel,
    };
  });

  return {
    vouchers,
    pagination: buildPaginationMeta(count ?? 0, paginationParams),
  };
}

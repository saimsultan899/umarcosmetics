import { one } from "@/lib/reports/helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Customer Receivables — printable field-collection list matching the paper
 * sheet (Acc ID · Customer name · Prev. balance · Last sale ID · Last sale ·
 * Last sale value · Final bal. · Received · Remarks), grouped by Sector.
 *
 * Scope:
 *  - "all"       — every customer shop (incl. Nil balances)
 *  - "warehouse" — shops served from a warehouse within [from, to]
 *  - "brand"     — shops that bought a brand (products.manufacturer) within [from, to]
 *
 * The Balance column is each shop's full running account balance as of `to`
 * (opening balance carried forward + all movement up to `to`). Balances are a
 * single consolidated ledger figure, so the brand/warehouse choice only narrows
 * WHICH shops appear — never the amount.
 */

export type RecoveryScope = "all" | "brand" | "warehouse";
export type RecoveryInclude = "all" | "dues" | "nonzero";

export type RecoverySheetRow = {
  party_id: string;
  party_code: string;
  name_en: string;
  city: string | null;
  route: string | null;
  balance: number;
  /** Balance before the last unpaid sale (sale after last recovery). */
  prev_balance: number;
  last_sale_id: string | null;
  last_sale_date: string | null;
  last_sale_value: number | null;
  /** Same as balance — shown as FINAL BAL. on the paper sheet. */
  final_balance: number;
  /** parties.head (town / head office label). */
  head: string | null;
  /** Latest posted recovery on or before `to`. */
  last_received_amount: number | null;
};

export type RecoverySheetSection = {
  /** Sector (parties.route) label; falls back to "No sector". */
  sector: string;
  rows: RecoverySheetRow[];
  count: number;
  dueTotal: number;
  crTotal: number;
  netTotal: number;
};

export type RecoverySheetResult = {
  sections: RecoverySheetSection[];
  flat: RecoverySheetRow[];
  grand: { count: number; dueTotal: number; crTotal: number; netTotal: number };
  /** Resolved, human-readable label for the active scope (e.g. "Brand — Sweet Face"). */
  scopeLabel: string;
  brandOptions: string[];
  warehouseOptions: { id: string; name: string }[];
};

export type RecoverySheetInput = {
  companyId: string;
  from: string;
  to: string;
  /** parties.route filter. Empty = all sectors. */
  sectors?: string[];
  /** Narrow to specific party ids. */
  partyIds?: string[];
  scope: RecoveryScope;
  /** manufacturer string when scope === "brand". */
  brand?: string;
  /** warehouse id when scope === "warehouse". */
  warehouseId?: string;
  include?: RecoveryInclude;
};

const NO_SECTOR = "No sector";

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

/** Parse a combined scope token from the URL: "all" | "wh:<id>" | "brand:<name>". */
export function parseScopeToken(token: string | undefined): {
  scope: RecoveryScope;
  brand?: string;
  warehouseId?: string;
} {
  if (!token || token === "all") return { scope: "all" };
  const sep = token.indexOf(":");
  if (sep === -1) return { scope: "all" };
  const kind = token.slice(0, sep);
  const value = token.slice(sep + 1);
  if (kind === "wh" && value) return { scope: "warehouse", warehouseId: value };
  if (kind === "brand" && value) return { scope: "brand", brand: value };
  return { scope: "all" };
}

export async function buildRecoverySheet(
  supabase: SupabaseClient,
  input: RecoverySheetInput,
): Promise<RecoverySheetResult> {
  const {
    companyId,
    from,
    to,
    sectors = [],
    scope,
    brand,
    warehouseId,
    partyIds = [],
    include = "all",
  } = input;

  // Dropdown sources + balances + authoritative shop list + last sales, all in parallel.
  const [manufacturers, warehouses, balanceSheet, partyRows, lastSales, lastRecoveries] =
    await Promise.all([
    supabase
      .from("products")
      .select("manufacturer")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .not("manufacturer", "is", null)
      .limit(20000),
    supabase
      .from("warehouses")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name"),
    supabase.rpc("get_recovery_sheet", {
      p_company_id: companyId,
      p_as_of: to,
      p_city: null,
      p_route: sectors.length === 1 ? sectors[0] : null,
    }),
    (() => {
      let query = supabase
        .from("parties")
        .select("id, party_code, name_en, city, route, head")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .in("party_subtype", ["customer", "both"]);
      if (sectors.length) query = query.in("route", sectors);
      if (partyIds.length) query = query.in("id", partyIds);
      return query.order("name_en").limit(20000);
    })(),
    fetchLastSalesByParty(supabase, companyId, to),
    fetchLastRecoveriesByParty(supabase, companyId, to),
  ]);

  if (balanceSheet.error) throw new Error(balanceSheet.error.message);
  if (partyRows.error) throw new Error(partyRows.error.message);

  const brandOptions = distinctSorted(
    (manufacturers.data || []).map((r) => r.manufacturer),
  );
  const warehouseOptions = (warehouses.data || []).map((w) => ({
    id: w.id as string,
    name: w.name as string,
  }));

  const balanceByParty = new Map<string, number>();
  for (const r of (balanceSheet.data || []) as Array<{
    party_id: string;
    balance: number | string;
  }>) {
    balanceByParty.set(r.party_id, Number(r.balance || 0));
  }

  // Narrow the shop set to those active in the chosen brand / warehouse.
  const activeSet = await resolveActiveParties(supabase, {
    companyId,
    from,
    to,
    scope,
    brand,
    warehouseId,
  });

  let flat: RecoverySheetRow[] = (partyRows.data || []).map((p) => {
    const partyId = p.id as string;
    const balance = balanceByParty.get(partyId) ?? 0;
    const last = lastSales.get(partyId);
    const lastReceived = lastRecoveries.get(partyId) ?? null;
    const saleIsOpen = isLastSaleAfterRecovery(last, lastReceived);
    const lastSaleValue = saleIsOpen && last ? last.grand_total : null;

    return {
      party_id: partyId,
      party_code: (p.party_code as string) || "",
      name_en: (p.name_en as string) || "",
      city: (p.city as string | null) ?? null,
      route: (p.route as string | null) ?? null,
      head: ((p.head as string | null) || "").trim() || null,
      balance,
      prev_balance: saleIsOpen && lastSaleValue != null
        ? balance - lastSaleValue
        : balance,
      last_sale_id: saleIsOpen ? last?.invoice_no ?? null : null,
      last_sale_date: saleIsOpen ? last?.invoice_date ?? null : null,
      last_sale_value: lastSaleValue,
      final_balance: balance,
      last_received_amount: lastReceived?.amount ?? null,
    };
  });

  if (activeSet) flat = flat.filter((r) => activeSet.has(r.party_id));
  if (include === "dues") flat = flat.filter((r) => r.balance > 0.005);
  else if (include === "nonzero")
    flat = flat.filter((r) => Math.abs(r.balance) > 0.005);

  const sections = groupBySector(flat);
  const grand = sections.reduce(
    (acc, s) => ({
      count: acc.count + s.count,
      dueTotal: acc.dueTotal + s.dueTotal,
      crTotal: acc.crTotal + s.crTotal,
      netTotal: acc.netTotal + s.netTotal,
    }),
    { count: 0, dueTotal: 0, crTotal: 0, netTotal: 0 },
  );

  const selectedParties =
    partyIds.length > 0
      ? (partyRows.data || []).filter((p) =>
          partyIds.includes(p.id as string),
        )
      : [];
  const scopeParts: string[] = [];
  if (scope === "warehouse") {
    scopeParts.push(
      `Company — ${warehouseOptions.find((w) => w.id === warehouseId)?.name || warehouseId || "?"}`,
    );
  } else if (scope === "brand") {
    scopeParts.push(`Brand — ${brand || "?"}`);
  }
  if (sectors.length) {
    scopeParts.push(
      sectors.length === 1
        ? `Sector — ${sectors[0]}`
        : `Sectors — ${sectors.length} selected`,
    );
  }
  if (selectedParties.length === 1) {
    const p = selectedParties[0];
    scopeParts.push(
      `Customer — ${((p.party_code as string) || "").trim()} ${(
        (p.name_en as string) || ""
      ).trim()}`.trim(),
    );
  } else if (selectedParties.length > 1) {
    scopeParts.push(`Customers — ${selectedParties.length} selected`);
  }
  const scopeLabel = scopeParts.length ? scopeParts.join(" · ") : "All customers";

  return {
    sections,
    flat,
    grand,
    scopeLabel,
    brandOptions,
    warehouseOptions,
  };
}

/**
 * Returns the set of party ids with posted sales activity for the chosen
 * brand/warehouse within [from, to], or null when scope === "all".
 */
async function resolveActiveParties(
  supabase: SupabaseClient,
  args: {
    companyId: string;
    from: string;
    to: string;
    scope: RecoveryScope;
    brand?: string;
    warehouseId?: string;
  },
): Promise<Set<string> | null> {
  const { companyId, from, to, scope, brand, warehouseId } = args;

  if (scope === "warehouse") {
    if (!warehouseId) return new Set();
    const { data, error } = await supabase
      .from("sale_invoices")
      .select("party_id")
      .eq("company_id", companyId)
      .eq("status", "posted")
      .eq("warehouse_id", warehouseId)
      .gte("invoice_date", from)
      .lte("invoice_date", to)
      .limit(50000);
    if (error) throw new Error(error.message);
    return new Set(
      (data || [])
        .map((r) => r.party_id as string | null)
        .filter((id): id is string => Boolean(id)),
    );
  }

  if (scope === "brand") {
    if (!brand) return new Set();
    // Products carrying this brand (manufacturer).
    const { data: prods, error: prodErr } = await supabase
      .from("products")
      .select("id")
      .eq("company_id", companyId)
      .eq("manufacturer", brand)
      .limit(20000);
    if (prodErr) throw new Error(prodErr.message);
    const productIds = (prods || []).map((p) => p.id as string);
    if (!productIds.length) return new Set();

    // Sale lines for those products, inner-joined to posted invoices in range.
    const { data: items, error: itemErr } = await supabase
      .from("sale_invoice_items")
      .select(
        "sale_invoices!inner(party_id, invoice_date, status, company_id)",
      )
      .in("product_id", productIds)
      .eq("sale_invoices.company_id", companyId)
      .eq("sale_invoices.status", "posted")
      .gte("sale_invoices.invoice_date", from)
      .lte("sale_invoices.invoice_date", to)
      .limit(100000);
    if (itemErr) throw new Error(itemErr.message);
    const set = new Set<string>();
    for (const it of items || []) {
      const inv = one(
        (
          it as unknown as {
            sale_invoices:
              | { party_id: string | null }
              | { party_id: string | null }[]
              | null;
          }
        ).sale_invoices,
      );
      if (inv?.party_id) set.add(inv.party_id);
    }
    return set;
  }

  return null;
}

async function fetchLastSalesByParty(
  supabase: SupabaseClient,
  companyId: string,
  to: string,
) {
  const { data, error } = await supabase
    .from("sale_invoices")
    .select("party_id, invoice_no, invoice_date, grand_total, created_at")
    .eq("company_id", companyId)
    .eq("status", "posted")
    .lte("invoice_date", to)
    .not("party_id", "is", null)
    .order("invoice_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50000);

  if (error) throw new Error(error.message);

  const map = new Map<
    string,
    {
      invoice_no: string;
      invoice_date: string;
      grand_total: number;
      created_at: string;
    }
  >();

  for (const row of data || []) {
    const partyId = row.party_id as string;
    if (!partyId || map.has(partyId)) continue;
    map.set(partyId, {
      invoice_no: String(row.invoice_no || ""),
      invoice_date: String(row.invoice_date || ""),
      grand_total: Number(row.grand_total || 0),
      created_at: String(row.created_at || ""),
    });
  }

  return map;
}

type LastRecovery = {
  amount: number;
  recovery_date: string;
  created_at: string;
};

function happenedAfter(
  aDate: string,
  aAt: string,
  bDate: string,
  bAt: string,
) {
  if (aDate > bDate) return true;
  if (aDate < bDate) return false;
  const aTime = new Date(aAt).getTime();
  const bTime = new Date(bAt).getTime();
  if (Number.isNaN(aTime) || Number.isNaN(bTime)) return aAt >= bAt;
  return aTime > bTime;
}

/** Last sale only counts if it is newer than the last recovery (or there is no recovery). */
function isLastSaleAfterRecovery(
  sale:
    | {
        invoice_date: string;
        created_at: string;
      }
    | undefined,
  recovery: LastRecovery | null,
) {
  if (!sale) return false;
  if (!recovery) return true;
  return happenedAfter(
    sale.invoice_date,
    sale.created_at,
    recovery.recovery_date,
    recovery.created_at,
  );
}

async function fetchLastRecoveriesByParty(
  supabase: SupabaseClient,
  companyId: string,
  to: string,
) {
  const { data, error } = await supabase
    .from("recoveries")
    .select("party_id, amount, recovery_date, created_at")
    .eq("company_id", companyId)
    .lte("recovery_date", to)
    .gt("amount", 0)
    .not("party_id", "is", null)
    .order("recovery_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50000);

  if (error) throw new Error(error.message);

  const map = new Map<string, LastRecovery>();
  for (const row of data || []) {
    const partyId = row.party_id as string;
    if (!partyId || map.has(partyId)) continue;
    map.set(partyId, {
      amount: Number(row.amount || 0),
      recovery_date: String(row.recovery_date || ""),
      created_at: String(row.created_at || ""),
    });
  }
  return map;
}

function groupBySector(rows: RecoverySheetRow[]): RecoverySheetSection[] {
  const map = new Map<string, RecoverySheetRow[]>();
  for (const row of rows) {
    const key = (row.route || "").trim() || NO_SECTOR;
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }

  const sections: RecoverySheetSection[] = [...map.entries()].map(
    ([sector, sectorRows]) => {
      let dueTotal = 0;
      let crTotal = 0;
      let netTotal = 0;
      for (const r of sectorRows) {
        netTotal += r.balance;
        if (r.balance > 0.005) dueTotal += r.balance;
        else if (r.balance < -0.005) crTotal += Math.abs(r.balance);
      }
      return {
        sector,
        rows: sectorRows,
        count: sectorRows.length,
        dueTotal,
        crTotal,
        netTotal,
      };
    },
  );

  // Real sectors A→Z, "No sector" always last.
  sections.sort((a, b) => {
    if (a.sector === NO_SECTOR) return 1;
    if (b.sector === NO_SECTOR) return -1;
    return a.sector.localeCompare(b.sector);
  });
  return sections;
}

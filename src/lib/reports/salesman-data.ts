import { one } from "@/lib/reports/helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Salesman-wise performance & recovery report.
 *
 * Two dimensions per salesman over [from, to]:
 *  - Sales  — posted `sale_invoices` attributed by `salesman_id` (authoritative).
 *  - Recovery — field/office `recoveries` attributed by `salesman_id` when set,
 *    otherwise to the salesman who owns the recovery's Sector (parties.route).
 */

const INVOICE_LIMIT = 10000;
const RECOVERY_LIMIT = 20000;
const UNASSIGNED = "unassigned";

export type SalesmanRow = {
  /** profile / auth user id, or "unassigned". */
  id: string;
  name: string;
  /** Sectors (parties.route) attributed to this salesman. */
  sectors: string[];
  bills: number;
  sales: number;
  /** Cash taken at/after invoicing (sale_invoices.amount_paid). */
  invoiceCash: number;
  /** Unpaid balance from this salesman's bills (sales − invoiceCash). */
  credit: number;
  /** Field/office recoveries attributed to this salesman by sector. */
  recovered: number;
  recoveryCount: number;
  /** invoiceCash + recovered — total cash this salesman brought in. */
  collected: number;
  avgBill: number;
};

export type SalesmanTotals = {
  bills: number;
  sales: number;
  invoiceCash: number;
  credit: number;
  recovered: number;
  recoveryCount: number;
  collected: number;
};

export type SalesmanTrendPoint = {
  name: string;
  sales: number;
  recovered: number;
};

export type SalesmanAttribution = "assignment" | "sales" | "mixed" | "none";

export type SalesmanHistorySale = {
  invoice_no: string;
  invoice_date: string;
  party: string;
  route: string | null;
  amount: number;
};

export type SalesmanHistoryRecovery = {
  recovery_date: string;
  party: string;
  route: string | null;
  amount: number;
  remarks: string | null;
};

export type SalesmanReportResult = {
  /** Rows for the current view, sorted by sales desc. */
  rows: SalesmanRow[];
  totals: SalesmanTotals;
  /** Best salesman by sales / recovery across all salesmen (ignores the salesman filter). */
  topBySales: SalesmanRow | null;
  topByRecovery: SalesmanRow | null;
  activeCount: number;
  rosterCount: number;
  trend: SalesmanTrendPoint[];
  salesmanOptions: { value: string; label: string }[];
  sectorOptions: string[];
  /** Recovered amount in sectors that could not be attributed to any salesman. */
  unassignedRecovered: number;
  attributionMode: SalesmanAttribution;
  error: string | null;
  /** Line-level history when a single salesman is filtered. */
  history: {
    sales: SalesmanHistorySale[];
    recoveries: SalesmanHistoryRecovery[];
  } | null;
};

export type SalesmanReportInput = {
  companyId: string;
  from: string;
  to: string;
  /** Limit to one salesman id, "unassigned", or "" for all. */
  salesmanId?: string;
  /** Limit to one Sector (parties.route). Empty = all sectors. */
  sector?: string;
};

type EmbeddedProfile = { id: string; full_name: string | null } | null;

function norm(v: string | null | undefined) {
  return (v || "").trim().toLowerCase();
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

export async function buildSalesmanReport(
  supabase: SupabaseClient,
  input: SalesmanReportInput,
): Promise<SalesmanReportResult> {
  const { companyId, from, to } = input;
  const salesmanId = input.salesmanId || "";
  const sector = input.sector || "";

  let invoiceQuery = supabase
    .from("sale_invoices")
    .select(
      "id, invoice_no, invoice_date, grand_total, amount_paid, route, salesman_id, parties(party_code, name_en), salesman:profiles!sale_invoices_salesman_id_fkey(id, full_name)",
    )
    .eq("company_id", companyId)
    .eq("status", "posted")
    .gte("invoice_date", from)
    .lte("invoice_date", to);
  if (sector) invoiceQuery = invoiceQuery.eq("route", sector);
  if (salesmanId === UNASSIGNED) invoiceQuery = invoiceQuery.is("salesman_id", null);
  else if (salesmanId) invoiceQuery = invoiceQuery.eq("salesman_id", salesmanId);

  let recoveryQuery = supabase
    .from("recoveries")
    .select(
      "recovery_date, amount, route, salesman_id, remarks, parties(party_code, name_en)",
    )
    .eq("company_id", companyId)
    .gte("recovery_date", from)
    .lte("recovery_date", to);
  if (sector) recoveryQuery = recoveryQuery.eq("route", sector);
  if (salesmanId === UNASSIGNED) recoveryQuery = recoveryQuery.is("salesman_id", null);
  else if (salesmanId) recoveryQuery = recoveryQuery.eq("salesman_id", salesmanId);

  const [invoicesRes, recoveriesRes, rosterRes, assignmentsRes, sectorRes] =
    await Promise.all([
      invoiceQuery
        .order("invoice_date", { ascending: true })
        .limit(INVOICE_LIMIT),
      recoveryQuery.limit(RECOVERY_LIMIT),
      supabase
        .from("company_members")
        .select("user_id, profiles(id, full_name)")
        .eq("company_id", companyId)
        .eq("role", "salesman")
        .eq("is_active", true),
      supabase
        .from("salesman_routes")
        .select("route, profiles(id, full_name)")
        .eq("company_id", companyId)
        .eq("is_active", true),
      supabase
        .from("parties")
        .select("route")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .not("route", "is", null)
        .limit(20000),
    ]);

  const error =
    invoicesRes.error?.message ||
    recoveriesRes.error?.message ||
    rosterRes.error?.message ||
    assignmentsRes.error?.message ||
    sectorRes.error?.message ||
    null;

  const invoices = (invoicesRes.data || []) as Array<{
    invoice_no: string;
    invoice_date: string | null;
    grand_total: number | string | null;
    amount_paid: number | string | null;
    route: string | null;
    salesman_id: string | null;
    parties:
      | { party_code: string; name_en: string }
      | { party_code: string; name_en: string }[]
      | null;
    salesman: EmbeddedProfile | EmbeddedProfile[];
  }>;
  const recoveries = (recoveriesRes.data || []) as Array<{
    recovery_date: string | null;
    amount: number | string | null;
    route: string | null;
    salesman_id: string | null;
    remarks: string | null;
    parties:
      | { party_code: string; name_en: string }
      | { party_code: string; name_en: string }[]
      | null;
  }>;

  // Active salesman roster — keyed by profile/user id, so idle salesmen still show.
  const rosterName = new Map<string, string>();
  for (const m of (rosterRes.data || []) as Array<{
    user_id: string | null;
    profiles: EmbeddedProfile | EmbeddedProfile[];
  }>) {
    const p = one(m.profiles);
    const id = p?.id || m.user_id || "";
    if (!id) continue;
    rosterName.set(id, p?.full_name || "Salesman");
  }

  // Sector → salesman ownership. Explicit assignments win.
  const routeToSalesman = new Map<string, { id: string; name: string }>();
  const routeDisplay = new Map<string, string>();
  let usedAssignment = false;
  for (const a of (assignmentsRes.data || []) as Array<{
    route: string | null;
    profiles: EmbeddedProfile | EmbeddedProfile[];
  }>) {
    const p = one(a.profiles);
    const route = (a.route || "").trim();
    if (!p?.id || !route) continue;
    const key = norm(route);
    if (routeToSalesman.has(key)) continue;
    usedAssignment = true;
    routeToSalesman.set(key, {
      id: p.id,
      name: p.full_name || rosterName.get(p.id) || "Salesman",
    });
    routeDisplay.set(key, route);
  }

  const agg = new Map<string, SalesmanRow>();
  const ensure = (id: string, name: string): SalesmanRow => {
    let r = agg.get(id);
    if (!r) {
      r = {
        id,
        name,
        sectors: [],
        bills: 0,
        sales: 0,
        invoiceCash: 0,
        credit: 0,
        recovered: 0,
        recoveryCount: 0,
        collected: 0,
        avgBill: 0,
      };
      agg.set(id, r);
    }
    return r;
  };

  // Seed idle salesmen as zero rows only in the all-sectors view.
  if (!sector) for (const [id, name] of rosterName) ensure(id, name);

  const trendByDate = new Map<string, { sales: number; recovered: number }>();
  // sector → salesman → sales, used to infer ownership where no assignment exists.
  const routeTally = new Map<string, Map<string, { name: string; amount: number }>>();

  for (const inv of invoices) {
    const sm = one(inv.salesman);
    const id = inv.salesman_id || UNASSIGNED;
    const name = sm?.full_name || rosterName.get(id) || "Unassigned";
    const total = Number(inv.grand_total || 0);
    const paid = Number(inv.amount_paid || 0);
    const row = ensure(id, name);
    row.bills += 1;
    row.sales += total;
    row.invoiceCash += paid;
    row.credit += total - paid;

    const d = inv.invoice_date || "";
    if (d) {
      const t = trendByDate.get(d) || { sales: 0, recovered: 0 };
      t.sales += total;
      trendByDate.set(d, t);
    }

    const routeKey = norm(inv.route);
    if (routeKey && inv.salesman_id) {
      const inner = routeTally.get(routeKey) || new Map();
      const cur = inner.get(inv.salesman_id) || { name, amount: 0 };
      cur.amount += total;
      inner.set(inv.salesman_id, cur);
      routeTally.set(routeKey, inner);
      if (!routeDisplay.has(routeKey))
        routeDisplay.set(routeKey, (inv.route || "").trim());
    }
  }

  // Fill unassigned sectors with the period's top-selling salesman there.
  let usedSalesFallback = false;
  for (const [routeKey, inner] of routeTally) {
    if (routeToSalesman.has(routeKey)) continue;
    let best: { id: string; name: string; amount: number } | null = null;
    for (const [sid, v] of inner) {
      if (!best || v.amount > best.amount)
        best = { id: sid, name: v.name, amount: v.amount };
    }
    if (best) {
      routeToSalesman.set(routeKey, { id: best.id, name: best.name });
      usedSalesFallback = true;
    }
  }

  let unassignedRecovered = 0;
  for (const rec of recoveries) {
    const amt = Number(rec.amount || 0);
    let id = UNASSIGNED;
    let name = "Unassigned";

    if (rec.salesman_id) {
      id = rec.salesman_id;
      name = rosterName.get(id) || "Salesman";
    } else {
      const routeKey = norm(rec.route);
      const owner = routeKey ? routeToSalesman.get(routeKey) : undefined;
      id = owner?.id || UNASSIGNED;
      name = owner?.name || "Unassigned";
      if (!owner) unassignedRecovered += amt;
    }

    const row = ensure(id, name);
    row.recovered += amt;
    row.recoveryCount += 1;

    const d = rec.recovery_date || "";
    if (d) {
      const t = trendByDate.get(d) || { sales: 0, recovered: 0 };
      t.recovered += amt;
      trendByDate.set(d, t);
    }
  }

  // Attribute each owned sector back to its salesman for the "Sectors" column.
  const sectorsBySalesman = new Map<string, Set<string>>();
  for (const [routeKey, owner] of routeToSalesman) {
    const disp = routeDisplay.get(routeKey) || routeKey;
    const set = sectorsBySalesman.get(owner.id) || new Set<string>();
    set.add(disp);
    sectorsBySalesman.set(owner.id, set);
  }
  for (const row of agg.values()) {
    row.sectors = [...(sectorsBySalesman.get(row.id) || [])].sort((a, b) =>
      a.localeCompare(b),
    );
    row.collected = row.invoiceCash + row.recovered;
    row.avgBill = row.bills ? row.sales / row.bills : 0;
  }

  const all = [...agg.values()];
  const rankable = all.filter((r) => r.id !== UNASSIGNED);
  const topBySales =
    [...rankable].filter((r) => r.sales > 0).sort((a, b) => b.sales - a.sales)[0] ||
    null;
  const topByRecovery =
    [...rankable]
      .filter((r) => r.recovered > 0)
      .sort((a, b) => b.recovered - a.recovered)[0] || null;

  let rows = all;
  if (salesmanId) rows = rows.filter((r) => r.id === salesmanId);
  rows.sort(
    (a, b) =>
      b.sales - a.sales ||
      b.recovered - a.recovered ||
      a.name.localeCompare(b.name),
  );

  const totals = rows.reduce<SalesmanTotals>(
    (acc, r) => {
      acc.bills += r.bills;
      acc.sales += r.sales;
      acc.invoiceCash += r.invoiceCash;
      acc.credit += r.credit;
      acc.recovered += r.recovered;
      acc.recoveryCount += r.recoveryCount;
      acc.collected += r.collected;
      return acc;
    },
    {
      bills: 0,
      sales: 0,
      invoiceCash: 0,
      credit: 0,
      recovered: 0,
      recoveryCount: 0,
      collected: 0,
    },
  );

  const activeCount = rows.filter(
    (r) => r.id !== UNASSIGNED && (r.bills > 0 || r.recovered > 0),
  ).length;

  const trend: SalesmanTrendPoint[] = [...trendByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, v]) => ({ name: d.slice(5), sales: v.sales, recovered: v.recovered }));

  let history: SalesmanReportResult["history"] = null;
  if (salesmanId) {
    history = {
      sales: invoices
        .map((inv) => {
          const p = one(inv.parties);
          return {
            invoice_no: inv.invoice_no,
            invoice_date: inv.invoice_date || "",
            party: p ? `${p.party_code} — ${p.name_en}` : "—",
            route: inv.route,
            amount: Number(inv.grand_total || 0),
          };
        })
        .sort((a, b) => b.invoice_date.localeCompare(a.invoice_date)),
      recoveries: recoveries
        .map((rec) => {
          const p = one(rec.parties);
          return {
            recovery_date: rec.recovery_date || "",
            party: p ? `${p.party_code} — ${p.name_en}` : "—",
            route: rec.route,
            amount: Number(rec.amount || 0),
            remarks: rec.remarks,
          };
        })
        .sort((a, b) => b.recovery_date.localeCompare(a.recovery_date)),
    };
  }

  const salesmanOptions = [...rosterName.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  salesmanOptions.push({ value: UNASSIGNED, label: "Unassigned" });

  const sectorOptions = distinctSorted(
    (sectorRes.data || []).map((r) => (r as { route: string | null }).route),
  );

  const attributionMode: SalesmanAttribution =
    usedAssignment && usedSalesFallback
      ? "mixed"
      : usedAssignment
        ? "assignment"
        : usedSalesFallback
          ? "sales"
          : "none";

  return {
    rows,
    totals,
    topBySales,
    topByRecovery,
    activeCount,
    rosterCount: rosterName.size,
    trend,
    salesmanOptions,
    sectorOptions,
    unassignedRecovered,
    attributionMode,
    error,
    history,
  };
}

import { expenseCategoryLabel } from "@/lib/expenses/categories";
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
  /** Salary posted to this salesman. */
  salary: number;
  /** Non-salary expenses tagged to this salesman. */
  otherExpenses: number;
  /** salary + otherExpenses. */
  totalExpenses: number;
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
  salary: number;
  otherExpenses: number;
  totalExpenses: number;
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

export type SalesmanHistoryExpense = {
  expense_date: string;
  expense_no: string;
  category: string;
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
    expenses: SalesmanHistoryExpense[];
  } | null;
};

export type SalesmanReportInput = {
  companyId: string;
  from: string;
  to: string;
  salesmanIds?: string[];
  sectors?: string[];
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
  const salesmanIds = input.salesmanIds || [];
  const sectors = input.sectors || [];

  let invoiceQuery = supabase
    .from("sale_invoices")
    .select(
      "id, invoice_no, invoice_date, grand_total, amount_paid, route, salesman_id, parties(party_code, name_en), salesman:salesmen!sale_invoices_salesman_id_fkey(id, full_name)",
    )
    .eq("company_id", companyId)
    .eq("status", "posted")
    .gte("invoice_date", from)
    .lte("invoice_date", to);
  if (sectors.length) invoiceQuery = invoiceQuery.in("route", sectors);
  if (salesmanIds.length === 1 && salesmanIds[0] === UNASSIGNED) {
    invoiceQuery = invoiceQuery.is("salesman_id", null);
  } else if (salesmanIds.length === 1) {
    invoiceQuery = invoiceQuery.eq("salesman_id", salesmanIds[0]);
  } else if (salesmanIds.length > 1) {
    const real = salesmanIds.filter((id) => id !== UNASSIGNED);
    const hasUnassigned = salesmanIds.includes(UNASSIGNED);
    if (hasUnassigned && real.length > 0) {
      invoiceQuery = invoiceQuery.or(
        `salesman_id.is.null,salesman_id.in.(${real.join(",")})`,
      );
    } else if (real.length > 0) {
      invoiceQuery = invoiceQuery.in("salesman_id", real);
    }
  }

  let recoveryQuery = supabase
    .from("recoveries")
    .select(
      "recovery_date, amount, route, salesman_id, remarks, parties(party_code, name_en), salesman:salesmen!recoveries_salesman_id_fkey(id, full_name)",
    )
    .eq("company_id", companyId)
    .gte("recovery_date", from)
    .lte("recovery_date", to);
  if (sectors.length) recoveryQuery = recoveryQuery.in("route", sectors);
  if (salesmanIds.length === 1 && salesmanIds[0] === UNASSIGNED) {
    recoveryQuery = recoveryQuery.is("salesman_id", null);
  } else if (salesmanIds.length === 1) {
    recoveryQuery = recoveryQuery.eq("salesman_id", salesmanIds[0]);
  } else if (salesmanIds.length > 1) {
    const real = salesmanIds.filter((id) => id !== UNASSIGNED);
    const hasUnassigned = salesmanIds.includes(UNASSIGNED);
    if (hasUnassigned && real.length > 0) {
      recoveryQuery = recoveryQuery.or(
        `salesman_id.is.null,salesman_id.in.(${real.join(",")})`,
      );
    } else if (real.length > 0) {
      recoveryQuery = recoveryQuery.in("salesman_id", real);
    }
  }

  let expenseQuery = supabase
    .from("expenses")
    .select(
      "expense_no, expense_date, category, amount, remarks, salesman_id, salesman:salesmen!expenses_salesman_id_fkey(id, full_name)",
    )
    .eq("company_id", companyId)
    .gte("expense_date", from)
    .lte("expense_date", to);
  if (salesmanIds.length === 1 && salesmanIds[0] === UNASSIGNED) {
    expenseQuery = expenseQuery.is("salesman_id", null);
  } else if (salesmanIds.length === 1) {
    expenseQuery = expenseQuery.eq("salesman_id", salesmanIds[0]);
  } else if (salesmanIds.length > 1) {
    const real = salesmanIds.filter((id) => id !== UNASSIGNED);
    const hasUnassigned = salesmanIds.includes(UNASSIGNED);
    if (hasUnassigned && real.length > 0) {
      expenseQuery = expenseQuery.or(
        `salesman_id.is.null,salesman_id.in.(${real.join(",")})`,
      );
    } else if (real.length > 0) {
      expenseQuery = expenseQuery.in("salesman_id", real);
    }
  }

  const [invoicesRes, recoveriesRes, expensesRes, rosterRes, assignmentsRes, sectorRes] =
    await Promise.all([
      invoiceQuery
        .order("invoice_date", { ascending: true })
        .limit(INVOICE_LIMIT),
      recoveryQuery.limit(RECOVERY_LIMIT),
      expenseQuery.limit(RECOVERY_LIMIT),
      supabase
        .from("salesmen")
        .select("id, full_name")
        .eq("company_id", companyId)
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
    expensesRes.error?.message ||
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
    salesman: EmbeddedProfile | EmbeddedProfile[];
  }>;
  const expenses = (expensesRes.data || []) as Array<{
    expense_no: string;
    expense_date: string | null;
    category: string;
    amount: number | string | null;
    remarks: string | null;
    salesman_id: string | null;
    salesman: EmbeddedProfile | EmbeddedProfile[];
  }>;

  // Active salesman roster — keyed by salesmen.id, so idle salesmen still show.
  const rosterName = new Map<string, string>();
  for (const m of (rosterRes.data || []) as Array<{
    id: string | null;
    full_name: string | null;
  }>) {
    const id = m.id || "";
    if (!id) continue;
    rosterName.set(id, m.full_name || "Salesman");
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
        salary: 0,
        otherExpenses: 0,
        totalExpenses: 0,
        avgBill: 0,
      };
      agg.set(id, r);
    }
    return r;
  };

  // Seed idle salesmen as zero rows only in the all-sectors view.
  if (!sectors.length) for (const [id, name] of rosterName) ensure(id, name);

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
      const sm = one(rec.salesman);
      name = sm?.full_name || rosterName.get(id) || "Salesman";
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

  // Expenses have no sector — only roll them in on the all-sectors view
  // (or a single-salesman filter, which is already applied on the query).
  if (!sectors.length) {
    for (const exp of expenses) {
      const amt = Number(exp.amount || 0);
      const id = exp.salesman_id || UNASSIGNED;
      const sm = one(exp.salesman);
      const name = sm?.full_name || rosterName.get(id) || "Unassigned";
      const row = ensure(id, name);
      if (exp.category === "salary") row.salary += amt;
      else row.otherExpenses += amt;
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
    row.totalExpenses = row.salary + row.otherExpenses;
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
  if (salesmanIds.length) {
    rows = rows.filter((r) => salesmanIds.includes(r.id));
  }
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
      acc.salary += r.salary;
      acc.otherExpenses += r.otherExpenses;
      acc.totalExpenses += r.totalExpenses;
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
      salary: 0,
      otherExpenses: 0,
      totalExpenses: 0,
    },
  );

  const activeCount = rows.filter(
    (r) => r.id !== UNASSIGNED && (r.bills > 0 || r.recovered > 0),
  ).length;

  const trend: SalesmanTrendPoint[] = [...trendByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, v]) => ({ name: d.slice(5), sales: v.sales, recovered: v.recovered }));

  let history: SalesmanReportResult["history"] = null;
  if (salesmanIds.length === 1) {
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
      expenses: expenses
        .map((exp) => ({
          expense_date: exp.expense_date || "",
          expense_no: exp.expense_no,
          category: expenseCategoryLabel(exp.category),
          amount: Number(exp.amount || 0),
          remarks: exp.remarks,
        }))
        .sort((a, b) => b.expense_date.localeCompare(a.expense_date)),
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

import { expenseCategoryLabel } from "@/lib/expenses/categories";
import { one } from "@/lib/reports/helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SalesmanLedgerLine = {
  date: string;
  type: "Sale" | "Recovery" | "Salary" | "Expense";
  particulars: string;
  sales: number;
  collected: number;
  expense: number;
  running: number;
};

export type SalesmanLedgerResult = {
  salesmanName: string;
  lines: SalesmanLedgerLine[];
  totals: {
    sales: number;
    collected: number;
    salary: number;
    otherExpenses: number;
    expenses: number;
    netCash: number;
  };
  error: string | null;
};

export async function buildSalesmanLedger(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    salesmanId: string;
    from: string;
    to: string;
  },
): Promise<SalesmanLedgerResult> {
  const empty: SalesmanLedgerResult = {
    salesmanName: "",
    lines: [],
    totals: {
      sales: 0,
      collected: 0,
      salary: 0,
      otherExpenses: 0,
      expenses: 0,
      netCash: 0,
    },
    error: null,
  };

  if (!input.salesmanId) return empty;

  const [salesmanRes, salesRes, recoveryRes, expenseRes] = await Promise.all([
    supabase
      .from("salesmen")
      .select("full_name")
      .eq("company_id", input.companyId)
      .eq("id", input.salesmanId)
      .maybeSingle(),
    supabase
      .from("sale_invoices")
      .select(
        "invoice_no, invoice_date, grand_total, amount_paid, parties(party_code, name_en)",
      )
      .eq("company_id", input.companyId)
      .eq("salesman_id", input.salesmanId)
      .eq("status", "posted")
      .gte("invoice_date", input.from)
      .lte("invoice_date", input.to)
      .order("invoice_date", { ascending: true })
      .limit(5000),
    supabase
      .from("recoveries")
      .select("recovery_date, amount, remarks, parties(party_code, name_en)")
      .eq("company_id", input.companyId)
      .eq("salesman_id", input.salesmanId)
      .gte("recovery_date", input.from)
      .lte("recovery_date", input.to)
      .order("recovery_date", { ascending: true })
      .limit(8000),
    supabase
      .from("expenses")
      .select("expense_no, expense_date, category, amount, remarks")
      .eq("company_id", input.companyId)
      .eq("salesman_id", input.salesmanId)
      .gte("expense_date", input.from)
      .lte("expense_date", input.to)
      .order("expense_date", { ascending: true })
      .limit(8000),
  ]);

  const error =
    salesmanRes.error?.message ||
    salesRes.error?.message ||
    recoveryRes.error?.message ||
    expenseRes.error?.message ||
    null;

  type Draft = Omit<SalesmanLedgerLine, "running">;
  const drafts: Draft[] = [];
  const totals = { ...empty.totals };

  for (const inv of salesRes.data || []) {
    const p = one(
      inv.parties as
        | { party_code: string; name_en: string }
        | { party_code: string; name_en: string }[]
        | null,
    );
    const sales = Number(inv.grand_total || 0);
    const paid = Number(inv.amount_paid || 0);
    totals.sales += sales;
    totals.collected += paid;
    drafts.push({
      date: inv.invoice_date || "",
      type: "Sale",
      particulars: `${inv.invoice_no} — ${p ? `${p.party_code} ${p.name_en}` : "shop"}`,
      sales,
      collected: paid,
      expense: 0,
    });
  }

  for (const rec of recoveryRes.data || []) {
    const p = one(
      rec.parties as
        | { party_code: string; name_en: string }
        | { party_code: string; name_en: string }[]
        | null,
    );
    const amt = Number(rec.amount || 0);
    totals.collected += amt;
    drafts.push({
      date: rec.recovery_date || "",
      type: "Recovery",
      particulars: `${p ? `${p.party_code} ${p.name_en}` : "shop"}${
        rec.remarks ? ` — ${rec.remarks}` : ""
      }`,
      sales: 0,
      collected: amt,
      expense: 0,
    });
  }

  for (const exp of expenseRes.data || []) {
    const amt = Number(exp.amount || 0);
    const isSalary = exp.category === "salary";
    if (isSalary) totals.salary += amt;
    else totals.otherExpenses += amt;
    totals.expenses += amt;
    drafts.push({
      date: exp.expense_date || "",
      type: isSalary ? "Salary" : "Expense",
      particulars: `${exp.expense_no} — ${expenseCategoryLabel(exp.category)}${
        exp.remarks ? ` — ${exp.remarks}` : ""
      }`,
      sales: 0,
      collected: 0,
      expense: amt,
    });
  }

  drafts.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d) return d;
    const order = { Sale: 0, Recovery: 1, Salary: 2, Expense: 3 };
    return order[a.type] - order[b.type];
  });

  let running = 0;
  const lines: SalesmanLedgerLine[] = drafts.map((row) => {
    running += row.collected - row.expense;
    return { ...row, running };
  });

  totals.netCash = totals.collected - totals.expenses;

  return {
    salesmanName: salesmanRes.data?.full_name || "Salesman",
    lines,
    totals,
    error,
  };
}

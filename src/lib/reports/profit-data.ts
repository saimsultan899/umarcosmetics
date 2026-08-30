import { expenseCategoryLabel } from "@/lib/expenses/categories";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ProfitDailyRow = {
  day: string;
  sales: number;
  returns: number;
  net_sales: number;
  expenses: number;
};

export type ProfitSummary = {
  from: string;
  to: string;
  sales: number;
  returns: number;
  net_sales: number;
  cogs: number;
  gross_profit: number;
  expenses: number;
  salary: number;
  other_expenses: number;
  net_profit: number;
  gross_margin_pct: number;
  net_margin_pct: number;
  daily: ProfitDailyRow[];
  expenses_by_category: { category: string; amount: number; label: string }[];
};

export type ProfitReportResult = {
  summary: ProfitSummary;
  error: string | null;
};

function num(v: unknown) {
  return Number(v || 0);
}

export async function buildProfitReport(
  supabase: SupabaseClient,
  input: { companyId: string; from: string; to: string },
): Promise<ProfitReportResult> {
  const { data, error } = await supabase.rpc("get_profit_summary", {
    p_company_id: input.companyId,
    p_from: input.from,
    p_to: input.to,
  });

  if (error) {
    return {
      summary: emptySummary(input.from, input.to),
      error: error.message,
    };
  }

  const raw = (data || {}) as Record<string, unknown>;
  const daily = ((raw.daily as ProfitDailyRow[]) || []).map((d) => ({
    day: String(d.day),
    sales: num(d.sales),
    returns: num(d.returns),
    net_sales: num(d.net_sales),
    expenses: num(d.expenses),
  }));

  const expensesByCategory = (
    (raw.expenses_by_category as Array<{ category: string; amount: number }>) || []
  ).map((row) => ({
    category: row.category,
    amount: num(row.amount),
    label: expenseCategoryLabel(row.category),
  }));

  return {
    summary: {
      from: String(raw.from || input.from),
      to: String(raw.to || input.to),
      sales: num(raw.sales),
      returns: num(raw.returns),
      net_sales: num(raw.net_sales),
      cogs: num(raw.cogs),
      gross_profit: num(raw.gross_profit),
      expenses: num(raw.expenses),
      salary: num(raw.salary),
      other_expenses: num(raw.other_expenses),
      net_profit: num(raw.net_profit),
      gross_margin_pct: num(raw.gross_margin_pct),
      net_margin_pct: num(raw.net_margin_pct),
      daily,
      expenses_by_category: expensesByCategory,
    },
    error: null,
  };
}

function emptySummary(from: string, to: string): ProfitSummary {
  return {
    from,
    to,
    sales: 0,
    returns: 0,
    net_sales: 0,
    cogs: 0,
    gross_profit: 0,
    expenses: 0,
    salary: 0,
    other_expenses: 0,
    net_profit: 0,
    gross_margin_pct: 0,
    net_margin_pct: 0,
    daily: [],
    expenses_by_category: [],
  };
}

import { expenseCategoryLabel } from "@/lib/expenses/categories";
import { one } from "@/lib/reports/helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

const LIMIT = 20000;

export type ExpenseReportLine = {
  id: string;
  expense_no: string;
  expense_date: string;
  category: string;
  categoryLabel: string;
  amount: number;
  remarks: string | null;
  salesmanId: string | null;
  salesmanName: string | null;
};

export type ExpenseReportResult = {
  lines: ExpenseReportLine[];
  totals: {
    count: number;
    amount: number;
    salary: number;
    other: number;
  };
  byCategory: { name: string; value: number }[];
  bySalesman: {
    id: string;
    name: string;
    salary: number;
    other: number;
    total: number;
  }[];
  trend: { name: string; value: number }[];
  error: string | null;
};

export async function buildExpenseReport(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    from: string;
    to: string;
    category?: string;
    salesmanId?: string;
  },
): Promise<ExpenseReportResult> {
  let query = supabase
    .from("expenses")
    .select(
      "id, expense_no, expense_date, category, amount, remarks, salesman_id, salesman:salesmen!expenses_salesman_id_fkey(id, full_name)",
    )
    .eq("company_id", input.companyId)
    .gte("expense_date", input.from)
    .lte("expense_date", input.to);

  if (input.category) query = query.eq("category", input.category);
  if (input.salesmanId === "unassigned") query = query.is("salesman_id", null);
  else if (input.salesmanId) query = query.eq("salesman_id", input.salesmanId);

  const { data, error } = await query
    .order("expense_date", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(LIMIT);

  const rows = (data || []) as Array<{
    id: string;
    expense_no: string;
    expense_date: string;
    category: string;
    amount: number | string | null;
    remarks: string | null;
    salesman_id: string | null;
    salesman:
      | { id: string; full_name: string | null }
      | { id: string; full_name: string | null }[]
      | null;
  }>;

  const lines: ExpenseReportLine[] = rows.map((r) => {
    const sm = one(r.salesman);
    return {
      id: r.id,
      expense_no: r.expense_no,
      expense_date: r.expense_date,
      category: r.category,
      categoryLabel: expenseCategoryLabel(r.category),
      amount: Number(r.amount || 0),
      remarks: r.remarks,
      salesmanId: r.salesman_id,
      salesmanName: sm?.full_name || null,
    };
  });

  const totals = { count: 0, amount: 0, salary: 0, other: 0 };
  const catMap = new Map<string, number>();
  const smMap = new Map<
    string,
    { id: string; name: string; salary: number; other: number; total: number }
  >();
  const dayMap = new Map<string, number>();

  for (const line of lines) {
    totals.count += 1;
    totals.amount += line.amount;
    if (line.category === "salary") totals.salary += line.amount;
    else totals.other += line.amount;

    catMap.set(
      line.categoryLabel,
      (catMap.get(line.categoryLabel) || 0) + line.amount,
    );

    const sid = line.salesmanId || "unassigned";
    const name = line.salesmanName || "Company / unassigned";
    const row = smMap.get(sid) || {
      id: sid,
      name,
      salary: 0,
      other: 0,
      total: 0,
    };
    if (line.category === "salary") row.salary += line.amount;
    else row.other += line.amount;
    row.total += line.amount;
    smMap.set(sid, row);

    if (line.expense_date) {
      dayMap.set(
        line.expense_date,
        (dayMap.get(line.expense_date) || 0) + line.amount,
      );
    }
  }

  return {
    lines,
    totals,
    byCategory: [...catMap.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value),
    bySalesman: [...smMap.values()].sort((a, b) => b.total - a.total),
    trend: [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, value]) => ({ name: d.slice(5), value })),
    error: error?.message || null,
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SYSTEM_EXPENSE_CATEGORIES,
  type ExpenseCategoryOption,
} from "@/lib/expenses/categories";

export type ExpenseCategoryRow = ExpenseCategoryOption & {
  id?: string;
  is_system?: boolean;
  sort_order?: number;
};

function asOptions(rows: unknown): ExpenseCategoryRow[] {
  if (!Array.isArray(rows)) return [];
  const out: ExpenseCategoryRow[] = [];
  for (const r of rows) {
    const row = r as Record<string, unknown>;
    const code = String(row.code || "").trim();
    const label = String(row.label || "").trim();
    if (!code || !label) continue;
    out.push({
      id: row.id ? String(row.id) : undefined,
      value: code,
      label,
      is_system: Boolean(row.is_system),
      sort_order:
        typeof row.sort_order === "number" ? row.sort_order : undefined,
    });
  }
  return out;
}

/** Company expense types (system + custom). Falls back to built-in list. */
export async function fetchExpenseCategories(
  supabase: SupabaseClient,
  companyId: string,
): Promise<ExpenseCategoryRow[]> {
  const { data, error } = await supabase.rpc("list_expense_categories", {
    p_company_id: companyId,
  });

  if (error) {
    // Older offline / mid-deploy: keep the form usable with defaults.
    console.warn("list_expense_categories failed:", error.message);
    return SYSTEM_EXPENSE_CATEGORIES.map((c) => ({ ...c, is_system: true }));
  }

  const options = asOptions(data);
  if (!options.length) {
    return SYSTEM_EXPENSE_CATEGORIES.map((c) => ({ ...c, is_system: true }));
  }
  return options;
}

export async function createExpenseCategory(
  supabase: SupabaseClient,
  payload: {
    organization_id: string;
    company_id: string;
    label: string;
  },
): Promise<ExpenseCategoryRow> {
  const { data, error } = await supabase.rpc("create_expense_category", {
    p_payload: payload,
  });

  if (error) throw new Error(error.message);

  const row = data as Record<string, unknown> | null;
  const code = String(row?.code || "").trim();
  const label = String(row?.label || payload.label).trim();
  if (!code) throw new Error("Could not create expense category");

  return {
    id: row?.id ? String(row.id) : undefined,
    value: code,
    label,
    is_system: Boolean(row?.is_system),
  };
}

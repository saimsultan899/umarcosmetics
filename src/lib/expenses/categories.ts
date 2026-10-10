export const SYSTEM_EXPENSE_CATEGORIES = [
  { value: "salary", label: "Salesman salary" },
  { value: "builty", label: "Builty expense" },
  { value: "fuel", label: "Fuel / petrol" },
  { value: "food", label: "Daily food" },
  { value: "rent", label: "Rent" },
  { value: "utilities", label: "Utilities (bill)" },
  { value: "conveyance", label: "Conveyance / travel" },
  { value: "loading", label: "Loading / labour" },
  { value: "stationery", label: "Stationery / office" },
  { value: "other", label: "Other" },
] as const;

/** @deprecated Use SYSTEM_EXPENSE_CATEGORIES — kept for older imports */
export const EXPENSE_CATEGORIES = SYSTEM_EXPENSE_CATEGORIES;

export type ExpenseCategoryOption = {
  value: string;
  label: string;
};

/** Category codes are free text (system + company custom). */
export type ExpenseCategory = string;

export function expenseCategoryLabel(
  value: string | null | undefined,
  extras?: Iterable<ExpenseCategoryOption> | null,
) {
  const code = (value || "").trim();
  if (!code) return "—";

  if (extras) {
    for (const c of extras) {
      if (c.value === code) return c.label;
    }
  }

  const system = SYSTEM_EXPENSE_CATEGORIES.find((c) => c.value === code);
  if (system) return system.label;

  // Custom codes: show a readable fallback until labels are loaded.
  return code
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function isSalaryCategory(value: string | null | undefined) {
  return value === "salary";
}

export function isBuiltyCategory(value: string | null | undefined) {
  return value === "builty";
}

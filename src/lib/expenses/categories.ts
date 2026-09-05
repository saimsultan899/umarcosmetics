export const EXPENSE_CATEGORIES = [
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

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["value"];

export function expenseCategoryLabel(value: string | null | undefined) {
  return (
    EXPENSE_CATEGORIES.find((c) => c.value === value)?.label || value || "—"
  );
}

export function isSalaryCategory(value: string | null | undefined) {
  return value === "salary";
}

export function isBuiltyCategory(value: string | null | undefined) {
  return value === "builty";
}

import {
  buildPaginationMeta,
  escapeIlike,
  parsePaginationParams,
  spString,
  toRange,
  type PaginationMeta,
} from "@/lib/pagination";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ExpenseRow = {
  id: string;
  expense_no: string;
  expense_date: string;
  category: string;
  amount: number;
  remarks: string | null;
  salesman_id: string | null;
  salesman_name: string | null;
  warehouse_name: string | null;
  vendor_name: string | null;
};

export type ExpenseListResult = {
  expenses: ExpenseRow[];
  pagination: PaginationMeta;
};

export async function fetchExpenseList(
  supabase: SupabaseClient,
  companyId: string,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<ExpenseListResult> {
  const paginationParams = parsePaginationParams(searchParams);
  const { from, to } = toRange(paginationParams);
  const q = spString(searchParams, "q") || "";
  const category = spString(searchParams, "category") || "";
  const salesman = spString(searchParams, "salesman") || "";

  let query = supabase
    .from("expenses")
    .select(
      "id, expense_no, expense_date, category, amount, remarks, salesman_id, salesman:salesmen!expenses_salesman_id_fkey(full_name), warehouse:warehouses!expenses_warehouse_id_fkey(name), vendor:parties!expenses_vendor_id_fkey(party_code, name_en)",
      { count: "exact" },
    )
    .eq("company_id", companyId);

  if (category) query = query.eq("category", category);
  if (salesman) query = query.eq("salesman_id", salesman);

  const term = escapeIlike(q);
  if (term) {
    const pattern = `%${term}%`;
    query = query.or(`expense_no.ilike.${pattern},remarks.ilike.${pattern}`);
  }

  const { data, count, error } = await query
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(error.message);

  return {
    expenses: (data || []).map((row) => {
      const salesmanRel = row.salesman as
        | { full_name: string | null }
        | { full_name: string | null }[]
        | null;
      const name = Array.isArray(salesmanRel)
        ? salesmanRel[0]?.full_name
        : salesmanRel?.full_name;
      const warehouseRel = row.warehouse as
        | { name: string | null }
        | { name: string | null }[]
        | null;
      const warehouseName = Array.isArray(warehouseRel)
        ? warehouseRel[0]?.name
        : warehouseRel?.name;
      const vendorRel = row.vendor as
        | { party_code: string | null; name_en: string | null }
        | { party_code: string | null; name_en: string | null }[]
        | null;
      const vendor = Array.isArray(vendorRel) ? vendorRel[0] : vendorRel;
      const vendorName = vendor
        ? [vendor.party_code, vendor.name_en].filter(Boolean).join(" — ")
        : null;
      return {
        id: row.id,
        expense_no: row.expense_no,
        expense_date: row.expense_date,
        category: row.category,
        amount: Number(row.amount || 0),
        remarks: row.remarks,
        salesman_id: row.salesman_id,
        salesman_name: name || null,
        warehouse_name: warehouseName || null,
        vendor_name: vendorName,
      };
    }),
    pagination: buildPaginationMeta(count ?? 0, paginationParams),
  };
}

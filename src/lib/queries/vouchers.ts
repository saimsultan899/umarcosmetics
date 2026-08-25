import {
  buildPaginationMeta,
  escapeIlike,
  parsePaginationParams,
  spString,
  toRange,
  type PaginationMeta,
} from "@/lib/pagination";
import type { SupabaseClient } from "@supabase/supabase-js";

export type VoucherRow = {
  id: string;
  voucher_no: string;
  voucher_date: string;
  total_amount: number;
  narration: string | null;
};

export type VoucherListResult = {
  vouchers: VoucherRow[];
  pagination: PaginationMeta;
};

export async function fetchVoucherList(
  supabase: SupabaseClient,
  companyId: string,
  searchParams: Record<string, string | string[] | undefined>,
  voucherType: "CR" | "CP" | "JV",
): Promise<VoucherListResult> {
  const paginationParams = parsePaginationParams(searchParams);
  const { from, to } = toRange(paginationParams);
  const q = spString(searchParams, "q") || "";

  let query = supabase
    .from("vouchers")
    .select("*", { count: "exact" })
    .eq("company_id", companyId)
    .eq("voucher_type", voucherType);

  const term = escapeIlike(q);
  if (term) {
    const pattern = `%${term}%`;
    query = query.or(`voucher_no.ilike.${pattern},narration.ilike.${pattern}`);
  }

  const { data, count, error } = await query
    .order("voucher_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(error.message);

  return {
    vouchers: (data || []) as VoucherRow[],
    pagination: buildPaginationMeta(count ?? 0, paginationParams),
  };
}

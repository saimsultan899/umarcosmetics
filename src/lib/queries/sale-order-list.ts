import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import {
  buildPaginationMeta,
  escapeIlike,
  parsePaginationParams,
  spString,
  toRange,
  type PaginationMeta,
} from "@/lib/pagination";
import {
  mapSaleOrder,
  SALE_ORDER_SELECT,
  type SaleOrderListRow,
  type SaleOrderQueryRow,
} from "@/lib/sales/sale-orders";

export type SaleOrderListSummary = {
  openCount: number;
  openAmount: number;
  fulfilledCount: number;
  fulfilledAmount: number;
  cancelledCount: number;
  cancelledAmount: number;
  filteredAmount: number;
  filteredQty: number;
  trend: Array<{ name: string; value: number }>;
};

type SummaryLine = { amount?: number | string | null; qty?: number | string | null };
type SummaryRow = {
  status: string;
  order_date: string;
  sale_order_lines: SummaryLine[] | null;
};

function isoDateParam(value: string | undefined) {
  const raw = (value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function quoteOrValue(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function lineTotals(lines: SummaryLine[] | null) {
  let amount = 0;
  let qty = 0;
  for (const line of lines || []) {
    amount += Number(line.amount || 0);
    qty += Number(line.qty || 0);
  }
  return { amount, qty };
}

export async function fetchSaleOrderList(
  supabase: SupabaseClient,
  companyId: string,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<{
  rows: SaleOrderListRow[];
  pagination: PaginationMeta;
  summary: SaleOrderListSummary;
}> {
  const paginationParams = parsePaginationParams(searchParams);
  const q = spString(searchParams, "q") || "";
  const salesman = spString(searchParams, "salesman") || "";
  const customer = spString(searchParams, "customer") || "";
  const status = spString(searchParams, "status") || "";
  let fromDate = isoDateParam(spString(searchParams, "fromDate"));
  let toDate = isoDateParam(spString(searchParams, "toDate"));
  if (fromDate && toDate && fromDate > toDate) {
    const swap = fromDate;
    fromDate = toDate;
    toDate = swap;
  }
  const term = escapeIlike(q);

  const [partyIds, salesmanIds] = term
    ? await Promise.all([
        (async () => {
          const pattern = quoteOrValue(`%${term}%`);
          const { data, error } = await supabase
            .from("parties")
            .select("id")
            .eq("company_id", companyId)
            .or(`party_code.ilike.${pattern},name_en.ilike.${pattern}`)
            .limit(300);
          if (error) throw new Error(error.message);
          return (data || []).map((row) => String(row.id));
        })(),
        (async () => {
          const { data, error } = await supabase
            .from("salesmen")
            .select("id")
            .eq("company_id", companyId)
            .ilike("full_name", `%${term}%`)
            .limit(50);
          if (error) throw new Error(error.message);
          return (data || []).map((row) => String(row.id));
        })(),
      ])
    : [[], []];

  function applyCommon(query: any) {
    let next = query.eq("company_id", companyId);
    if (salesman === "unassigned") next = next.is("salesman_id", null);
    else if (salesman) next = next.eq("salesman_id", salesman);
    if (customer) next = next.eq("party_id", customer);
    if (fromDate) next = next.gte("order_date", fromDate);
    if (toDate) next = next.lte("order_date", toDate);
    if (term) {
      const pattern = quoteOrValue(`%${term}%`);
      const parts = [`order_no.ilike.${pattern}`];
      if (partyIds.length) parts.push(`party_id.in.(${partyIds.join(",")})`);
      if (salesmanIds.length) parts.push(`salesman_id.in.(${salesmanIds.join(",")})`);
      next = next.or(parts.join(","));
    }
    return next;
  }

  function pageQuery() {
    let next = applyCommon(
      supabase.from("sale_orders").select(SALE_ORDER_SELECT, { count: "exact" }),
    );
    if (status) next = next.eq("status", status);
    return next
      .order("order_date", { ascending: false })
      .order("created_at", { ascending: false });
  }

  const summarySelect = "status, order_date, sale_order_lines(amount, qty)";
  const [{ data, count, error }, summaryRows] = await Promise.all([
    pageQuery().range(toRange(paginationParams).from, toRange(paginationParams).to),
    fetchAllPages<SummaryRow>(
      (from, to) =>
        applyCommon(supabase.from("sale_orders").select(summarySelect))
          .order("order_date", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      { maxRows: 8000 },
    ),
  ]);
  if (error) throw new Error(error.message);

  const total = count ?? 0;
  const pagination = buildPaginationMeta(total, paginationParams);
  let rows = ((data || []) as unknown as SaleOrderQueryRow[]).map(mapSaleOrder);

  if (pagination.page !== paginationParams.page) {
    const again = await pageQuery().range(
      (pagination.page - 1) * pagination.pageSize,
      pagination.page * pagination.pageSize - 1,
    );
    if (again.error) throw new Error(again.error.message);
    rows = ((again.data || []) as unknown as SaleOrderQueryRow[]).map(mapSaleOrder);
  }

  const summary: SaleOrderListSummary = {
    openCount: 0,
    openAmount: 0,
    fulfilledCount: 0,
    fulfilledAmount: 0,
    cancelledCount: 0,
    cancelledAmount: 0,
    filteredAmount: 0,
    filteredQty: 0,
    trend: [],
  };
  const trendMap = new Map<string, number>();
  for (const row of summaryRows) {
    const totals = lineTotals(row.sale_order_lines);
    if (row.status === "open") {
      summary.openCount += 1;
      summary.openAmount += totals.amount;
    } else if (row.status === "fulfilled") {
      summary.fulfilledCount += 1;
      summary.fulfilledAmount += totals.amount;
    } else if (row.status === "cancelled") {
      summary.cancelledCount += 1;
      summary.cancelledAmount += totals.amount;
    }
    const inFilter = !status || row.status === status;
    if (!inFilter) continue;
    summary.filteredAmount += totals.amount;
    summary.filteredQty += totals.qty;
    const date = String(row.order_date || "").slice(0, 10);
    if (date) trendMap.set(date, (trendMap.get(date) || 0) + totals.amount);
  }
  summary.trend = [...trendMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(-14);

  return { rows, pagination, summary };
}

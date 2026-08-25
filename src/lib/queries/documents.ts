import {
  buildPaginationMeta,
  escapeIlike,
  parsePaginationParams,
  spString,
  toRange,
  type PaginationMeta,
} from "@/lib/pagination";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DocumentListRow = {
  id: string;
  docNo: string;
  date: string;
  partyLabel: string;
  warehouseLabel?: string;
  paymentType?: string;
  total: number;
  href: string;
  table: string;
  linesTable: string;
  linesFk: string;
  extraFields?: Array<{ label: string; value: string }>;
};

export type DocumentListSummary = {
  totalAmount: number;
  cashTotal: number;
  creditTotal: number;
  trend: Array<{ name: string; value: number }>;
  mix: Array<{ name: string; value: number }>;
};

type DocumentTableConfig = {
  table: string;
  partySelect: string;
  warehouseSelect?: string;
  dateField: string;
  docNoField: string;
  paymentField?: string;
  hrefPrefix: string;
  linesTable: string;
  linesFk: string;
  mapExtra?: (row: Record<string, unknown>) => Array<{ label: string; value: string }>;
};

const SALE_CONFIG: DocumentTableConfig = {
  table: "sale_invoices",
  partySelect: "parties(name_en, party_code)",
  warehouseSelect: "warehouses(name)",
  dateField: "invoice_date",
  docNoField: "invoice_no",
  paymentField: "payment_type",
  hrefPrefix: "/sales/invoices",
  linesTable: "sale_invoice_items",
  linesFk: "sale_invoice_id",
};

const PURCHASE_CONFIG: DocumentTableConfig = {
  table: "purchase_invoices",
  partySelect: "parties(name_en, party_code)",
  warehouseSelect: "warehouses(name)",
  dateField: "invoice_date",
  docNoField: "invoice_no",
  hrefPrefix: "/purchases/invoices",
  linesTable: "purchase_invoice_items",
  linesFk: "purchase_invoice_id",
  mapExtra: (inv) => [
    {
      label: "Supplier bill #",
      value: String(inv.supplier_bill_no || "—"),
    },
  ],
};

const SALE_RETURN_CONFIG: DocumentTableConfig = {
  table: "sale_returns",
  partySelect: "parties(name_en, party_code)",
  warehouseSelect: "warehouses(name)",
  dateField: "return_date",
  docNoField: "return_no",
  hrefPrefix: "/sales/returns",
  linesTable: "sale_return_items",
  linesFk: "sale_return_id",
};

const PURCHASE_RETURN_CONFIG: DocumentTableConfig = {
  table: "purchase_returns",
  partySelect: "parties(name_en, party_code)",
  warehouseSelect: "warehouses(name)",
  dateField: "return_date",
  docNoField: "return_no",
  hrefPrefix: "/purchases/returns",
  linesTable: "purchase_return_items",
  linesFk: "purchase_return_id",
};

function mapDocumentRow(
  inv: Record<string, unknown>,
  config: DocumentTableConfig,
): DocumentListRow {
  const party = Array.isArray(inv.parties) ? inv.parties[0] : inv.parties;
  const wh = config.warehouseSelect
    ? Array.isArray(inv.warehouses)
      ? inv.warehouses[0]
      : inv.warehouses
    : null;
  const partyObj = party as { party_code?: string; name_en?: string } | null;
  const whObj = wh as { name?: string } | null;

  return {
    id: String(inv.id),
    docNo: String(inv[config.docNoField] || inv.id),
    date: String(inv[config.dateField] || ""),
    partyLabel: partyObj
      ? `${partyObj.party_code} — ${partyObj.name_en}`
      : "—",
    warehouseLabel: whObj?.name || "—",
    paymentType: config.paymentField
      ? String(inv[config.paymentField] || "")
      : undefined,
    total: Number(inv.grand_total || 0),
    href: `${config.hrefPrefix}/${inv.id}`,
    table: config.table,
    linesTable: config.linesTable,
    linesFk: config.linesFk,
    extraFields: config.mapExtra?.(inv),
  };
}

function applyDocumentSearch(query: any, q: string, docNoField: string) {
  const term = escapeIlike(q);
  if (!term) return query;
  return query.ilike(docNoField, `%${term}%`);
}

export async function fetchDocumentList(
  supabase: SupabaseClient,
  companyId: string,
  searchParams: Record<string, string | string[] | undefined>,
  config: DocumentTableConfig,
  options?: { showPaymentFilter?: boolean },
): Promise<{
  rows: DocumentListRow[];
  pagination: PaginationMeta;
  summary: DocumentListSummary;
}> {
  const paginationParams = parsePaginationParams(searchParams);
  const { from, to } = toRange(paginationParams);
  const q = spString(searchParams, "q") || "";
  const payment = spString(searchParams, "payment") || "all";
  const warehouseId = spString(searchParams, "warehouse") || "";

  const selectParts = [
    "*",
    config.partySelect,
    config.warehouseSelect,
  ].filter(Boolean);

  let listQuery = supabase
    .from(config.table)
    .select(selectParts.join(", "), { count: "exact" })
    .eq("company_id", companyId);
  listQuery = applyDocumentSearch(listQuery, q, config.docNoField);
  if (warehouseId && config.warehouseSelect) {
    listQuery = listQuery.eq("warehouse_id", warehouseId);
  }
  if (options?.showPaymentFilter && payment !== "all" && config.paymentField) {
    listQuery = listQuery.eq(config.paymentField, payment);
  }

  const dateField = config.dateField;
  const recentSelect = config.paymentField
    ? `${dateField}, grand_total, ${config.paymentField}`
    : `${dateField}, grand_total`;

  const [{ data, count, error }, recent] = await Promise.all([
    listQuery
      .order(dateField, { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to),
    supabase
      .from(config.table)
      .select(recentSelect)
      .eq("company_id", companyId)
      .order(dateField, { ascending: false })
      .limit(300),
  ]);

  if (error) throw new Error(error.message);

  const rows = (data || []).map((row) =>
    mapDocumentRow(row as unknown as Record<string, unknown>, config),
  );
  const total = count ?? 0;
  const pagination = buildPaginationMeta(total, paginationParams);

  const recentRows = (recent.data || []) as unknown as Array<
    Record<string, string | number | null>
  >;
  const totalAmount = recentRows.reduce(
    (sum, row) => sum + Number(row.grand_total || 0),
    0,
  );
  const cashTotal = recentRows
    .filter((row) => row.payment_type === "cash")
    .reduce((sum, row) => sum + Number(row.grand_total || 0), 0);
  const creditTotal = recentRows
    .filter((row) =>
      ["credit", "partial"].includes(String(row.payment_type || "")),
    )
    .reduce((sum, row) => sum + Number(row.grand_total || 0), 0);

  const trendMap = new Map<string, number>();
  for (const row of recentRows.slice(0, 60)) {
    const date = String(row[dateField] || "").slice(0, 10);
    if (!date) continue;
    trendMap.set(date, (trendMap.get(date) || 0) + Number(row.grand_total || 0));
  }
  const trend = [...trendMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(-14);

  const mixMap = new Map<string, number>();
  for (const row of recentRows) {
    const key = String(row.payment_type || "n/a").toUpperCase();
    mixMap.set(key, (mixMap.get(key) || 0) + Number(row.grand_total || 0));
  }

  return {
    rows,
    pagination,
    summary: {
      totalAmount,
      cashTotal,
      creditTotal,
      trend,
      mix: [...mixMap.entries()].map(([name, value]) => ({ name, value })),
    },
  };
}

export const documentListConfigs = {
  sale: SALE_CONFIG,
  purchase: PURCHASE_CONFIG,
  saleReturn: SALE_RETURN_CONFIG,
  purchaseReturn: PURCHASE_RETURN_CONFIG,
};

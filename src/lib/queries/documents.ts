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
  /** Columns the list actually renders. Avoids shipping every document field. */
  columns: string;
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
  columns: "id, invoice_no, invoice_date, payment_type, grand_total",
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
  columns: "id, invoice_no, invoice_date, grand_total, supplier_bill_no",
  mapExtra: (inv) => [
    {
      label: "Vendor bill #",
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
  columns: "id, return_no, return_date, grand_total",
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
  columns: "id, return_no, return_date, grand_total",
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
  return query.or(
    `${docNoField}.ilike.%${term}%,parties.party_code.ilike.%${term}%,parties.name_en.ilike.%${term}%`,
  );
}

/** Inner-join the party only while searching, so code/name filters drop non-matches. */
function selectForSearch(select: string, searching: boolean) {
  if (!searching) return select;
  if (select.includes("parties!inner(")) return select;
  if (select.includes("parties(")) {
    return select.replace("parties(", "parties!inner(");
  }
  return `${select}, parties!inner(party_code, name_en)`;
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

  const searching = Boolean(escapeIlike(q));
  const selectParts = [
    config.columns,
    config.partySelect,
    config.warehouseSelect,
  ].filter(Boolean);

  let listQuery = supabase
    .from(config.table)
    .select(selectForSearch(selectParts.join(", "), searching), { count: "exact" })
    .eq("company_id", companyId);
  if (
    config.table === "sale_invoices" ||
    config.table === "purchase_invoices" ||
    config.table === "sale_returns" ||
    config.table === "purchase_returns"
  ) {
    listQuery = listQuery.neq("status", "cancelled");
  }
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

  const isTradingDoc = [
    "sale_invoices",
    "purchase_invoices",
    "sale_returns",
    "purchase_returns",
  ].includes(config.table);

  let summaryQuery = supabase
    .from(config.table)
    .select(selectForSearch(recentSelect, searching))
    .eq("company_id", companyId);
  if (isTradingDoc) {
    summaryQuery = summaryQuery.neq("status", "cancelled");
  }
  summaryQuery = applyDocumentSearch(summaryQuery, q, config.docNoField);
  if (warehouseId && config.warehouseSelect) {
    summaryQuery = summaryQuery.eq("warehouse_id", warehouseId);
  }
  if (options?.showPaymentFilter && payment !== "all" && config.paymentField) {
    summaryQuery = summaryQuery.eq(config.paymentField, payment);
  }

  const [{ data, count, error }, recent] = await Promise.all([
    listQuery
      .order(dateField, { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to),
    summaryQuery.order(dateField, { ascending: false }).limit(5000),
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

const EXPIRY_RECEIPT_CONFIG: DocumentTableConfig = {
  table: "expiry_receipts",
  partySelect: "parties(name_en, party_code)",
  dateField: "receipt_date",
  docNoField: "receipt_no",
  hrefPrefix: "/inventory/expiry/receipts",
  linesTable: "expiry_receipt_items",
  linesFk: "receipt_id",
  columns: "id, receipt_no, receipt_date, grand_total, period_from, period_to",
  mapExtra: (row) =>
    row.period_from && row.period_to
      ? [
          {
            label: "Sold between",
            value: `${row.period_from} → ${row.period_to}`,
          },
        ]
      : [],
};

const EXPIRY_CLAIM_CONFIG: DocumentTableConfig = {
  table: "expiry_claims",
  partySelect: "parties(name_en, party_code)",
  warehouseSelect: "warehouses(name)",
  dateField: "claim_date",
  docNoField: "claim_no",
  hrefPrefix: "/inventory/expiry/claims",
  linesTable: "expiry_claim_items",
  linesFk: "claim_id",
  columns: "id, claim_no, claim_date, grand_total, claim_status",
  mapExtra: (row) => [
    {
      label: "Claim status",
      value: String(row.claim_status || "open"),
    },
  ],
};

export const documentListConfigs = {
  sale: SALE_CONFIG,
  purchase: PURCHASE_CONFIG,
  saleReturn: SALE_RETURN_CONFIG,
  purchaseReturn: PURCHASE_RETURN_CONFIG,
  expiryReceipt: EXPIRY_RECEIPT_CONFIG,
  expiryClaim: EXPIRY_CLAIM_CONFIG,
};

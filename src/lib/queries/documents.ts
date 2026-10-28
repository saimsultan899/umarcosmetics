import {
  buildPaginationMeta,
  escapeIlike,
  parsePaginationParams,
  spString,
  toRange,
  type PaginationMeta,
} from "@/lib/pagination";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import { wasEdited } from "@/lib/trading/edited-sales";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DocumentListRow = {
  id: string;
  docNo: string;
  date: string;
  partyLabel: string;
  /** parties.route — shop sector / town for sale lists. */
  sectorLabel?: string;
  warehouseLabel?: string;
  paymentType?: string;
  total: number;
  href: string;
  table: string;
  linesTable: string;
  linesFk: string;
  extraFields?: Array<{ label: string; value: string }>;
  /** Saved locally; waiting for sync to the server. */
  syncPending?: boolean;
  /** Changed after the bill was first saved. */
  edited?: boolean;
  /** Purchase invoice — vendor / company bill number. */
  supplierBillNo?: string;
  /** Purchase invoice — linked gate pass number. */
  gatePassNo?: string;
  /** Purchase invoice — date on the company / brand bill. */
  companyInvoiceDate?: string;
  discountTotal?: number;
  extraDiscount?: number;
  amountDifference?: number;
  narration?: string;
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
  partySelect: "parties(name_en, party_code, route)",
  warehouseSelect: "warehouses(name)",
  dateField: "invoice_date",
  docNoField: "invoice_no",
  paymentField: "payment_type",
  hrefPrefix: "/sales/invoices",
  linesTable: "sale_invoice_items",
  linesFk: "sale_invoice_id",
  columns: "id, invoice_no, invoice_date, payment_type, grand_total, created_at, updated_at",
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
  columns:
    "id, invoice_no, invoice_date, grand_total, supplier_bill_no, company_invoice_date, discount_total, extra_discount, amount_difference, narration, created_at, updated_at, gate_passes(pass_no)",
  mapExtra: (inv) => {
    const gate = Array.isArray(inv.gate_passes)
      ? inv.gate_passes[0]
      : inv.gate_passes;
    const gateNo =
      gate && typeof gate === "object"
        ? String((gate as { pass_no?: string }).pass_no || "")
        : "";
    const extras: Array<{ label: string; value: string }> = [
      {
        label: "Company invoice #",
        value: String(inv.supplier_bill_no || "—"),
      },
    ];
    if (gateNo) extras.push({ label: "Gate pass", value: gateNo });
    if (inv.company_invoice_date) {
      extras.push({
        label: "Company invoice date",
        value: String(inv.company_invoice_date),
      });
    }
    const disc =
      Number(inv.discount_total || 0) + Number(inv.extra_discount || 0);
    if (disc > 0.005) {
      extras.push({ label: "Discount", value: String(disc) });
    }
    const diff = Number(inv.amount_difference || 0);
    if (Math.abs(diff) > 0.005) {
      extras.push({ label: "Amount difference", value: String(diff) });
    }
    if (inv.narration) {
      extras.push({ label: "Narration", value: String(inv.narration) });
    }
    return extras;
  },
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
  columns: "id, return_no, return_date, grand_total, created_at, updated_at",
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
  columns: "id, return_no, return_date, grand_total, created_at, updated_at",
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
  const partyObj = party as {
    party_code?: string;
    name_en?: string;
    route?: string | null;
  } | null;
  const whObj = wh as { name?: string } | null;
  const sectorLabel = (partyObj?.route || "").trim();

  const gate = Array.isArray(inv.gate_passes)
    ? inv.gate_passes[0]
    : inv.gate_passes;
  const gateObj = gate as { pass_no?: string } | null;

  return {
    id: String(inv.id),
    docNo: String(inv[config.docNoField] || inv.id),
    date: String(inv[config.dateField] || ""),
    partyLabel: partyObj
      ? `${partyObj.party_code} — ${partyObj.name_en}`
      : "—",
    sectorLabel: sectorLabel || undefined,
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
    edited: wasEdited(inv.created_at, inv.updated_at),
    supplierBillNo: inv.supplier_bill_no
      ? String(inv.supplier_bill_no)
      : undefined,
    gatePassNo: gateObj?.pass_no ? String(gateObj.pass_no) : undefined,
    companyInvoiceDate: inv.company_invoice_date
      ? String(inv.company_invoice_date).slice(0, 10)
      : undefined,
    discountTotal:
      inv.discount_total != null ? Number(inv.discount_total) : undefined,
    extraDiscount:
      inv.extra_discount != null ? Number(inv.extra_discount) : undefined,
    amountDifference:
      inv.amount_difference != null
        ? Number(inv.amount_difference)
        : undefined,
    narration: inv.narration ? String(inv.narration) : undefined,
  };
}

/** Quote a value inside a PostgREST `or` filter so spaces and hyphens stay literal. */
function quoteOrValue(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Customer/vendor matches are applied as party ids.
 * Filtering `parties.party_code` inside `or` makes PostgREST return PGRST100
 * and the invoice list page crashes.
 */
async function partyIdsForSearch(
  supabase: SupabaseClient,
  companyId: string,
  term: string,
) {
  const pattern = quoteOrValue(`%${term}%`);
  const { data, error } = await supabase
    .from("parties")
    .select("id")
    .eq("company_id", companyId)
    .or(
      `party_code.ilike.${pattern},name_en.ilike.${pattern},route.ilike.${pattern}`,
    )
    .limit(300);
  if (error) throw new Error(error.message);
  return (data || []).map((row) => String(row.id));
}

async function partyIdsForSector(
  supabase: SupabaseClient,
  companyId: string,
  sector: string,
) {
  const data = await fetchAllPages<{ id: string }>((from, to) =>
    supabase
      .from("parties")
      .select("id")
      .eq("company_id", companyId)
      .eq("route", sector)
      .order("id")
      .range(from, to),
  );
  return data.map((row) => String(row.id));
}

function isoDateParam(value: string | undefined) {
  const raw = (value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

/** Start of a calendar day in Asia/Karachi, as UTC ISO for timestamptz filters. */
function pktDayStartUtc(isoDate: string) {
  return new Date(`${isoDate}T00:00:00+05:00`).toISOString();
}

function pktNextDayStartUtc(isoDate: string) {
  const d = new Date(`${isoDate}T00:00:00+05:00`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/**
 * Match documents whose bill date OR save date falls in [from, to].
 * Sale / purchase forms often keep an older invoice_date while posting later —
 * filtering only invoice_date hides those rows when staff filter "today".
 */
function applyDateRange(
  query: any,
  dateField: string,
  fromDate: string,
  toDate: string,
) {
  let from = fromDate;
  let to = toDate;
  if (from && to && from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  if (!from && !to) return query;

  const docParts: string[] = [];
  const createdParts: string[] = [];
  if (from) {
    docParts.push(`${dateField}.gte.${from}`);
    createdParts.push(`created_at.gte.${pktDayStartUtc(from)}`);
  }
  if (to) {
    docParts.push(`${dateField}.lte.${to}`);
    createdParts.push(`created_at.lt.${pktNextDayStartUtc(to)}`);
  }

  const docClause =
    docParts.length === 1 ? docParts[0] : `and(${docParts.join(",")})`;
  const createdClause =
    createdParts.length === 1
      ? createdParts[0]
      : `and(${createdParts.join(",")})`;

  return query.or(`${docClause},${createdClause}`);
}

function applyDocumentSearch(
  query: any,
  term: string,
  docNoField: string,
  partyIds: string[],
) {
  if (!term) return query;
  const pattern = quoteOrValue(`%${term}%`);
  const parts = [`${docNoField}.ilike.${pattern}`];
  if (partyIds.length > 0) {
    parts.push(`party_id.in.(${partyIds.join(",")})`);
  }
  return query.or(parts.join(","));
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
  const sector = (spString(searchParams, "sector") || "").trim();
  const fromDate = isoDateParam(spString(searchParams, "fromDate"));
  const toDate = isoDateParam(spString(searchParams, "toDate"));
  const dateField = config.dateField;

  const term = escapeIlike(q);
  let partyIds = term
    ? await partyIdsForSearch(supabase, companyId, term)
    : [];
  const sectorPartyIds = sector
    ? await partyIdsForSector(supabase, companyId, sector)
    : null;
  if (sectorPartyIds) {
    const allowed = new Set(sectorPartyIds);
    if (partyIds.length) {
      partyIds = partyIds.filter((id) => allowed.has(id));
    }
  }
  const selectParts = [
    config.columns,
    config.partySelect,
    config.warehouseSelect,
  ].filter(Boolean);

  let listQuery = supabase
    .from(config.table)
    .select(selectParts.join(", "), { count: "exact" })
    .eq("company_id", companyId);
  if (
    config.table === "sale_invoices" ||
    config.table === "purchase_invoices" ||
    config.table === "sale_returns" ||
    config.table === "purchase_returns" ||
    config.table === "expiry_receipts" ||
    config.table === "expiry_claims"
  ) {
    listQuery = listQuery.neq("status", "cancelled");
  }
  if (sectorPartyIds) {
    if (sectorPartyIds.length === 0) {
      listQuery = listQuery.eq("party_id", "00000000-0000-0000-0000-000000000000");
    } else {
      listQuery = listQuery.in("party_id", sectorPartyIds);
    }
  }
  listQuery = applyDocumentSearch(listQuery, term, config.docNoField, partyIds);
  if (warehouseId && config.warehouseSelect) {
    listQuery = listQuery.eq("warehouse_id", warehouseId);
  }
  if (options?.showPaymentFilter && payment !== "all" && config.paymentField) {
    listQuery = listQuery.eq(config.paymentField, payment);
  }
  // Date filters apply whenever present (sale payment toolbar or purchase dates).
  listQuery = applyDateRange(listQuery, dateField, fromDate, toDate);

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
    .select(recentSelect)
    .eq("company_id", companyId);
  if (isTradingDoc) {
    summaryQuery = summaryQuery.neq("status", "cancelled");
  }
  if (sectorPartyIds) {
    if (sectorPartyIds.length === 0) {
      summaryQuery = summaryQuery.eq(
        "party_id",
        "00000000-0000-0000-0000-000000000000",
      );
    } else {
      summaryQuery = summaryQuery.in("party_id", sectorPartyIds);
    }
  }
  summaryQuery = applyDocumentSearch(
    summaryQuery,
    term,
    config.docNoField,
    partyIds,
  );
  if (warehouseId && config.warehouseSelect) {
    summaryQuery = summaryQuery.eq("warehouse_id", warehouseId);
  }
  if (options?.showPaymentFilter && payment !== "all" && config.paymentField) {
    summaryQuery = summaryQuery.eq(config.paymentField, payment);
  }
  summaryQuery = applyDateRange(summaryQuery, dateField, fromDate, toDate);

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
  columns:
    "id, receipt_no, receipt_date, grand_total, period_from, period_to, balance_only",
  mapExtra: (row) => [
    ...(row.period_from && row.period_to
      ? [
          {
            label: "Sold between",
            value: `${row.period_from} → ${row.period_to}`,
          },
        ]
      : []),
    ...(row.balance_only
      ? [
          {
            label: "Type",
            value: "Balance only (old/manual sale — no expiry stock)",
          },
        ]
      : []),
  ],
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

/** All matching rows for Excel / PDF / print (paged past the list cap). */
export async function fetchDocumentsForExport(
  supabase: SupabaseClient,
  companyId: string,
  searchParams: Record<string, string | string[] | undefined>,
  config: DocumentTableConfig,
  options?: { showPaymentFilter?: boolean },
): Promise<DocumentListRow[]> {
  const q = spString(searchParams, "q") || "";
  const payment = spString(searchParams, "payment") || "all";
  const warehouseId = spString(searchParams, "warehouse") || "";
  const sector = (spString(searchParams, "sector") || "").trim();
  const fromDate = isoDateParam(spString(searchParams, "fromDate"));
  const toDate = isoDateParam(spString(searchParams, "toDate"));
  const dateField = config.dateField;

  const term = escapeIlike(q);
  let partyIds = term
    ? await partyIdsForSearch(supabase, companyId, term)
    : [];
  const sectorPartyIds = sector
    ? await partyIdsForSector(supabase, companyId, sector)
    : null;
  if (sectorPartyIds) {
    const allowed = new Set(sectorPartyIds);
    if (partyIds.length) {
      partyIds = partyIds.filter((id) => allowed.has(id));
    }
  }

  const selectParts = [
    config.columns,
    config.partySelect,
    config.warehouseSelect,
  ].filter(Boolean);

  const rows = await fetchAllPages<Record<string, unknown>>((from, to) => {
    let query = supabase
      .from(config.table)
      .select(selectParts.join(", "))
      .eq("company_id", companyId);
    if (
      config.table === "sale_invoices" ||
      config.table === "purchase_invoices" ||
      config.table === "sale_returns" ||
      config.table === "purchase_returns" ||
      config.table === "expiry_receipts" ||
      config.table === "expiry_claims"
    ) {
      query = query.neq("status", "cancelled");
    }
    if (sectorPartyIds) {
      if (sectorPartyIds.length === 0) {
        query = query.eq("party_id", "00000000-0000-0000-0000-000000000000");
      } else {
        query = query.in("party_id", sectorPartyIds);
      }
    }
    query = applyDocumentSearch(query, term, config.docNoField, partyIds);
    if (warehouseId && config.warehouseSelect) {
      query = query.eq("warehouse_id", warehouseId);
    }
    if (
      options?.showPaymentFilter &&
      payment !== "all" &&
      config.paymentField
    ) {
      query = query.eq(config.paymentField, payment);
    }
    query = applyDateRange(query, dateField, fromDate, toDate);
    return query
      .order(dateField, { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);
  });

  return rows.map((row) => mapDocumentRow(row, config));
}

export function documentListExportRows(
  rows: DocumentListRow[],
  opts?: { partyColumnLabel?: string; purchaseRich?: boolean },
): Record<string, unknown>[] {
  const partyLabel = opts?.partyColumnLabel || "Party";
  if (opts?.purchaseRich) {
    return rows.map((r) => ({
      "Doc #": r.docNo,
      Date: r.date,
      [partyLabel]: r.partyLabel,
      Company: r.warehouseLabel || "",
      "Company invoice #": r.supplierBillNo || "",
      "Gate pass": r.gatePassNo || "",
      "Company invoice date": r.companyInvoiceDate || "",
      Discount:
        Number(r.discountTotal || 0) + Number(r.extraDiscount || 0) || "",
      "Amount difference":
        r.amountDifference != null && Math.abs(r.amountDifference) > 0.005
          ? r.amountDifference
          : "",
      Narration: r.narration || "",
      Total: r.total,
    }));
  }
  return rows.map((r) => ({
    "Doc #": r.docNo,
    Date: r.date,
    [partyLabel]: r.partyLabel,
    ...(r.sectorLabel != null ? { Sector: r.sectorLabel } : {}),
    ...(r.warehouseLabel != null ? { Company: r.warehouseLabel } : {}),
    ...(r.paymentType ? { Payment: r.paymentType } : {}),
    Total: r.total,
  }));
}

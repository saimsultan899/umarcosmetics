/**
 * Offline report aggregation from SQLite (desktop) or IndexedDB caches.
 */

import { getCachedRows, getStockDeltas, type CacheStoreName } from "@/lib/offline/local-db";
import { formatReportInvNo } from "@/lib/reports/helpers";

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function inDateRange(dateStr: unknown, from?: string | null, to?: string | null) {
  if (!dateStr || typeof dateStr !== "string") return false;
  const d = dateStr.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export type OfflineReportFilters = {
  companyId: string;
  from?: string | null;
  to?: string | null;
};

async function loadRows(store: CacheStoreName, companyId: string) {
  let sqliteRows: Record<string, unknown>[] = [];
  try {
    const {
      hasLocalSqlite,
      localListMaster,
      localListDocuments,
      localListByEntity,
      localListDocumentsByTypes,
      MASTER_CACHE_TO_SQLITE,
      CACHE_STORE_TO_ENTITY,
    } = await import("@/lib/offline/sqlite-client");

    if (hasLocalSqlite()) {
      const master = MASTER_CACHE_TO_SQLITE[store];
      if (master) {
        const res = await localListMaster(master, companyId);
        if (res.rows?.length) sqliteRows = res.rows;
      }
      if (store === "sale_invoices" || store === "purchase_invoices") {
        const res = await localListDocuments(store, companyId);
        if (res.rows?.length) sqliteRows = res.rows;
      }
      const entity = CACHE_STORE_TO_ENTITY[store];
      if (entity) {
        const res = await localListByEntity(companyId, entity);
        if (res.rows?.length) sqliteRows = res.rows;
      }
      if (store === "vouchers") {
        const res = await localListDocumentsByTypes(companyId, [
          "recovery",
          "cash_receipt",
          "cash_payment",
          "journal_voucher",
          "voucher",
        ]);
        if (res.rows?.length) sqliteRows = res.rows;
      }
    }
  } catch {
    /* fall through to IndexedDB */
  }

  const idbRows = await getCachedRows(store, companyId);
  if (sqliteRows.length === 0) return idbRows;
  if (idbRows.length === 0) return sqliteRows;

  // Merge both sources so no cloud-cached or locally-created record is ever missing
  const seen = new Set(sqliteRows.map((r) => String(r.id || r._localId || r.invoice_no || r.doc_no)));
  const merged = [...sqliteRows];
  for (const r of idbRows) {
    const k = String(r.id || r._localId || r.invoice_no || r.doc_no);
    if (!seen.has(k)) {
      merged.push(r);
      seen.add(k);
    }
  }
  return merged;
}

/**
 * Load multiple stores in a single IPC round-trip via batchQuery.
 * Falls back to individual loadRows calls if batchQuery is unavailable.
 */
async function loadMultipleRows(
  stores: CacheStoreName[],
  companyId: string,
): Promise<Record<string, unknown>[][]> {
  try {
    const {
      hasLocalSqlite,
      localBatchQuery,
      MASTER_CACHE_TO_SQLITE,
      CACHE_STORE_TO_ENTITY,
    } = await import("@/lib/offline/sqlite-client");

    if (hasLocalSqlite()) {
      const specs = stores.map((store) => {
        const master = MASTER_CACHE_TO_SQLITE[store];
        if (master) return { store: master, companyId };
        if (store === "sale_invoices" || store === "purchase_invoices") {
          return { store, companyId };
        }
        const entity = CACHE_STORE_TO_ENTITY[store];
        if (entity) {
          return { store: "local_documents", companyId, entityType: entity };
        }
        if (store === "vouchers") {
          return {
            store: "local_documents",
            companyId,
            entityTypes: ["recovery", "cash_receipt", "cash_payment", "journal_voucher", "voucher"],
          };
        }
        return { store, companyId };
      });

      const res = await localBatchQuery(specs);
      if (res.ok && res.results.length === stores.length) {
        const final: Record<string, unknown>[][] = [];
        for (let i = 0; i < stores.length; i++) {
          const sqlRows = res.results[i] || [];
          const idbRows = await getCachedRows(stores[i], companyId);
          if (sqlRows.length === 0) {
            final.push(idbRows);
          } else if (idbRows.length === 0) {
            final.push(sqlRows);
          } else {
            const seen = new Set(
              sqlRows.map((r) => String(r.id || r._localId || r.invoice_no || r.doc_no)),
            );
            const merged = [...sqlRows];
            for (const r of idbRows) {
              const k = String(r.id || r._localId || r.invoice_no || r.doc_no);
              if (!seen.has(k)) {
                merged.push(r);
                seen.add(k);
              }
            }
            final.push(merged);
          }
        }
        return final;
      }
    }
  } catch {
    /* fall through */
  }

  // Fallback: individual loads
  return Promise.all(stores.map((store) => loadRows(store, companyId)));
}

export async function offlineSalesSummary(filters: OfflineReportFilters) {
  const rows = await loadRows("sale_invoices", filters.companyId);
  const filtered = rows.filter(
    (r) =>
      (r.status === "posted" || !r.status) &&
      inDateRange(r.invoice_date, filters.from, filters.to),
  );
  const total = filtered.reduce((s, r) => s + num(r.grand_total), 0);
  const byDay = new Map<string, number>();
  for (const r of filtered) {
    const d = String(r.invoice_date).slice(0, 10);
    byDay.set(d, (byDay.get(d) || 0) + num(r.grand_total));
  }
  return {
    count: filtered.length,
    total,
    rows: filtered,
    byDay: [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, amount]) => ({ date, amount })),
  };
}

export async function offlinePurchasesSummary(filters: OfflineReportFilters) {
  const rows = await loadRows("purchase_invoices", filters.companyId);
  const filtered = rows.filter(
    (r) =>
      (r.status === "posted" || !r.status) &&
      inDateRange(r.invoice_date, filters.from, filters.to),
  );
  const total = filtered.reduce((s, r) => s + num(r.grand_total), 0);
  return { count: filtered.length, total, rows: filtered };
}

export async function offlineRecoverySummary(filters: OfflineReportFilters) {
  const rows = await loadRows("vouchers", filters.companyId);
  const filtered = rows.filter((r) => {
    const type = String(r.voucher_type || r.type || r.entity_type || "");
    const isRecovery =
      type === "cash_receipt" ||
      type === "recovery" ||
      type === "receipt";
    return (
      isRecovery &&
      inDateRange(r.voucher_date || r.doc_date, filters.from, filters.to)
    );
  });
  const total = filtered.reduce(
    (s, r) => s + num(r.amount ?? r.total_amount ?? r.grand_total),
    0,
  );
  return { count: filtered.length, total, rows: filtered };
}

export async function offlineStockSnapshot(companyId: string) {
  const balances = await loadRows("stock_balances", companyId);
  const deltas = await getStockDeltas(companyId);
  const deltaMap = new Map<string, number>();
  for (const d of deltas) {
    const key = `${d.productId}:${d.warehouseId}`;
    deltaMap.set(key, (deltaMap.get(key) || 0) + d.delta);
  }
  return balances.map((b) => {
    const row = b as Record<string, unknown>;
    const pid = String(row.product_id || "");
    const wid = String(row.warehouse_id || "");
    const adj = deltaMap.get(`${pid}:${wid}`) || 0;
    return {
      ...row,
      product_id: pid,
      warehouse_id: wid,
      products: row.products,
      qty: num(row.qty) + adj,
      _offlineAdjusted: adj !== 0,
    };
  });
}

export async function offlineExpensesSummary(filters: OfflineReportFilters) {
  const rows = await loadRows("expenses", filters.companyId);
  const filtered = rows.filter((r) =>
    inDateRange(r.expense_date || r.doc_date, filters.from, filters.to),
  );
  const total = filtered.reduce((s, r) => s + num(r.amount ?? r.total_amount), 0);
  return { count: filtered.length, total, rows: filtered };
}

export async function offlineExpirySummary(filters: OfflineReportFilters) {
  const [receipts, claims] = await Promise.all([
    loadRows("expiry_receipts", filters.companyId),
    loadRows("expiry_claims", filters.companyId),
  ]);
  return {
    receipts: receipts.filter((r) =>
      inDateRange(r.receipt_date || r.doc_date, filters.from, filters.to),
    ),
    claims: claims.filter((r) =>
      inDateRange(r.claim_date || r.doc_date, filters.from, filters.to),
    ),
  };
}

export async function offlineCachedDocument(
  store: CacheStoreName,
  companyId: string,
  id: string,
) {
  const rows = await loadRows(store, companyId);
  return rows.find((r) => String(r.id) === id) || null;
}

function partyLabel(row: Record<string, unknown>) {
  const nested = row.parties as
    | { party_code?: string; name_en?: string }
    | undefined;
  const code = String(nested?.party_code || row.party_code || "");
  const name = String(nested?.name_en || row.party_name || row.name_en || "");
  return [code, name].filter(Boolean).join(" ").trim() || String(row.party_id || "");
}

function daysBetween(fromIso: string, toIso: string) {
  const a = new Date(`${fromIso.slice(0, 10)}T00:00:00`);
  const b = new Date(`${toIso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

/** Approximate party balances from local sales/purchases/receipts/payments. */
export async function offlineAccountsBalances(companyId: string) {
  const [parties, sales, purchases, saleReturns, purchaseReturns, vouchers] =
    await loadMultipleRows(
      ["parties", "sale_invoices", "purchase_invoices", "sale_returns", "purchase_returns", "vouchers"],
      companyId,
    );

  const bal = new Map<string, number>();
  const meta = new Map<
    string,
    { party_code: string; name_en: string; city: string | null; route: string | null; credit_limit: number }
  >();

  for (const p of parties) {
    const id = String(p.id || "");
    if (!id) continue;
    meta.set(id, {
      party_code: String(p.party_code || ""),
      name_en: String(p.name_en || "Party"),
      city: p.city == null ? null : String(p.city),
      route: p.route == null ? null : String(p.route),
      credit_limit: num(p.credit_limit),
    });
    bal.set(id, num(p.opening_balance));
  }

  const bump = (partyId: unknown, delta: number) => {
    const id = String(partyId || "");
    if (!id) return;
    bal.set(id, (bal.get(id) || 0) + delta);
  };

  for (const r of sales) {
    if (r.status && r.status !== "posted") continue;
    bump(r.party_id, num(r.grand_total) - num(r.amount_paid));
  }
  for (const r of saleReturns) {
    bump(r.party_id, -num(r.grand_total));
  }
  for (const r of purchases) {
    if (r.status && r.status !== "posted") continue;
    // Vendor payable is negative (Cr) in recovery-sheet convention
    bump(r.party_id, -num(r.grand_total));
  }
  for (const r of purchaseReturns) {
    bump(r.party_id, num(r.grand_total));
  }

  for (const r of vouchers) {
    const type = String(r.voucher_type || r.type || r.entity_type || "");
    const amount = num(r.amount ?? r.total_amount ?? r.grand_total);
    const payload = (r.payload as Record<string, unknown> | undefined) || r;
    const lines = Array.isArray(payload.lines)
      ? (payload.lines as Record<string, unknown>[])
      : null;

    if (lines?.length) {
      for (const line of lines) {
        const lineAmt = num(line.amount);
        if (type === "cash_receipt" || type === "recovery" || type === "CR") {
          bump(line.party_id || r.party_id, -lineAmt);
        } else if (type === "cash_payment" || type === "CP") {
          bump(line.party_id || r.party_id, lineAmt);
        } else if (type === "journal_voucher" || type === "JV") {
          bump(line.debit_party_id, lineAmt);
          bump(line.credit_party_id, -lineAmt);
        }
      }
    } else if (type === "cash_receipt" || type === "recovery" || type === "CR") {
      bump(r.party_id, -amount);
    } else if (type === "cash_payment" || type === "CP") {
      bump(r.party_id, amount);
    }
  }

  return [...bal.entries()]
    .map(([party_id, balance]) => {
      const m = meta.get(party_id) || {
        party_code: "",
        name_en: party_id.slice(0, 8),
        city: null,
        route: null,
        credit_limit: 0,
      };
      return {
        party_id,
        party_code: m.party_code,
        name_en: m.name_en,
        city: m.city,
        route: m.route,
        balance,
        credit_limit: m.credit_limit,
      };
    })
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
}

/** Reconstruct a simple party ledger from local documents. */
export async function offlinePartyLedger(
  companyId: string,
  partyId: string,
) {
  const [parties, sales, purchases, saleReturns, purchaseReturns, vouchers] =
    await loadMultipleRows(
      ["parties", "sale_invoices", "purchase_invoices", "sale_returns", "purchase_returns", "vouchers"],
      companyId,
    );

  const party = parties.find((p) => String(p.id) === partyId);
  let running = num(party?.opening_balance);
  type Draft = {
    date: string;
    type: string;
    narration: string;
    debit: number;
    credit: number;
  };
  const drafts: Draft[] = [
    {
      date: "",
      type: "OP",
      narration: "Opening balance",
      debit: running > 0 ? running : 0,
      credit: running < 0 ? Math.abs(running) : 0,
    },
  ];

  const push = (date: unknown, type: string, narration: string, debit: number, credit: number) => {
    drafts.push({
      date: String(date || "").slice(0, 10),
      type,
      narration,
      debit,
      credit,
    });
  };

  for (const r of sales) {
    if (String(r.party_id) !== partyId) continue;
    const total = num(r.grand_total);
    const paid = num(r.amount_paid);
    const no = formatReportInvNo(String(r.invoice_no || r.doc_no || r.id)) || String(r.invoice_no || r.id);
    if (total) push(r.invoice_date, "SI", `Sale ${no}`, total, 0);
    if (paid) push(r.invoice_date, "SI-CASH", `Cash on ${no}`, 0, paid);
  }
  for (const r of saleReturns) {
    if (String(r.party_id) !== partyId) continue;
    const no = formatReportInvNo(String(r.doc_no || r.return_no || r.id)) || String(r.doc_no || r.id);
    push(r.return_date || r.doc_date, "SR", `Sale return ${no}`, 0, num(r.grand_total));
  }
  for (const r of purchases) {
    if (String(r.party_id) !== partyId) continue;
    const no = formatReportInvNo(String(r.invoice_no || r.doc_no || r.id)) || String(r.invoice_no || r.id);
    push(r.invoice_date, "PI", `Purchase ${no}`, 0, num(r.grand_total));
  }
  for (const r of purchaseReturns) {
    if (String(r.party_id) !== partyId) continue;
    const no = formatReportInvNo(String(r.doc_no || r.return_no || r.id)) || String(r.doc_no || r.id);
    push(r.return_date || r.doc_date, "PR", `Purchase return ${no}`, num(r.grand_total), 0);
  }
  for (const r of vouchers) {
    const type = String(r.voucher_type || r.type || r.entity_type || "");
    const payload = (r.payload as Record<string, unknown> | undefined) || r;
    const lines = Array.isArray(payload.lines)
      ? (payload.lines as Record<string, unknown>[])
      : null;
    if (lines?.length) {
      for (const line of lines) {
        const amt = num(line.amount);
        if (
          (type === "cash_receipt" || type === "recovery" || type === "CR") &&
          String(line.party_id || r.party_id) === partyId
        ) {
          push(r.voucher_date || r.doc_date, "CR", String(line.narration || r.narration || "Receipt"), 0, amt);
        } else if (
          (type === "cash_payment" || type === "CP") &&
          String(line.party_id || r.party_id) === partyId
        ) {
          push(r.voucher_date || r.doc_date, "CP", String(line.narration || r.narration || "Payment"), amt, 0);
        } else if (type === "journal_voucher" || type === "JV") {
          if (String(line.debit_party_id) === partyId) {
            push(r.voucher_date || r.doc_date, "JV", String(line.narration || "Journal"), amt, 0);
          }
          if (String(line.credit_party_id) === partyId) {
            push(r.voucher_date || r.doc_date, "JV", String(line.narration || "Journal"), 0, amt);
          }
        }
      }
    } else if (String(r.party_id) === partyId) {
      const amt = num(r.amount ?? r.total_amount ?? r.grand_total);
      if (type === "cash_receipt" || type === "recovery" || type === "CR") {
        push(r.voucher_date || r.doc_date, "CR", String(r.narration || "Receipt"), 0, amt);
      } else if (type === "cash_payment" || type === "CP") {
        push(r.voucher_date || r.doc_date, "CP", String(r.narration || "Payment"), amt, 0);
      }
    }
  }

  drafts.sort((a, b) => {
    if (!a.date) return -1;
    if (!b.date) return 1;
    return a.date.localeCompare(b.date);
  });

  running = num(party?.opening_balance);
  const signed = (n: number) => {
    if (Math.abs(n) < 0.005) return "Nil";
    if (n > 0) return `${n.toFixed(2)} Dr`;
    return `${Math.abs(n).toFixed(2)} Cr`;
  };

  return {
    partyName: party
      ? `${party.party_code || ""} ${party.name_en || ""}`.trim()
      : partyId,
    rows: drafts.map((e, idx) => {
      if (idx > 0) running += e.debit - e.credit;
      return {
        Date: e.date,
        Type: e.type,
        Narration: e.narration,
        Debit: e.debit,
        Credit: e.credit,
        Balance: signed(running),
      };
    }),
  };
}

/** Aging from unpaid local sale invoices (approximate buckets). */
export async function offlineReceivableAging(
  companyId: string,
  asOf: string,
) {
  const [parties, sales] = await Promise.all([
    loadRows("parties", companyId),
    loadRows("sale_invoices", companyId),
  ]);
  const partyMap = new Map(parties.map((p) => [String(p.id), p]));

  type Bucket = {
    party_id: string;
    party_code: string;
    name_en: string;
    city: string | null;
    route: string | null;
    balance: number;
    bucket_current: number;
    bucket_30: number;
    bucket_60: number;
    bucket_90: number;
    bucket_90_plus: number;
    credit_limit: number;
  };

  const byParty = new Map<string, Bucket>();

  for (const inv of sales) {
    if (inv.status && inv.status !== "posted") continue;
    const due = num(inv.grand_total) - num(inv.amount_paid);
    if (due <= 0.005) continue;
    const partyId = String(inv.party_id || "");
    if (!partyId) continue;
    const invDate = String(inv.invoice_date || "").slice(0, 10);
    if (invDate && invDate > asOf) continue;
    const age = invDate ? daysBetween(invDate, asOf) : 0;
    const p = partyMap.get(partyId);
    let row = byParty.get(partyId);
    if (!row) {
      row = {
        party_id: partyId,
        party_code: String(p?.party_code || ""),
        name_en: String(p?.name_en || partyLabel(inv) || "Customer"),
        city: p?.city == null ? null : String(p.city),
        route: p?.route == null ? null : String(p.route),
        balance: 0,
        bucket_current: 0,
        bucket_30: 0,
        bucket_60: 0,
        bucket_90: 0,
        bucket_90_plus: 0,
        credit_limit: num(p?.credit_limit),
      };
      byParty.set(partyId, row);
    }
    row.balance += due;
    if (age <= 30) row.bucket_current += due;
    else if (age <= 60) row.bucket_30 += due;
    else if (age <= 90) row.bucket_60 += due;
    else if (age <= 180) row.bucket_90 += due;
    else row.bucket_90_plus += due;
  }

  return [...byParty.values()].sort((a, b) => b.balance - a.balance);
}

/** Local P&L approximation from invoices, returns, expenses, and product costs. */
export async function offlineProfitSummary(filters: OfflineReportFilters) {
  const [sales, saleReturns, purchases, purchaseReturns, expenses, expiryReceipts, expiryClaims, products] =
    await loadMultipleRows(
      ["sale_invoices", "sale_returns", "purchase_invoices", "purchase_returns", "expenses", "expiry_receipts", "expiry_claims", "products"],
      filters.companyId,
    );

  const costByProduct = new Map<string, number>();
  for (const p of products) {
    costByProduct.set(String(p.id), num(p.purchase_rate ?? p.purchase_price));
  }

  const salesF = sales.filter(
    (r) =>
      (!r.status || r.status === "posted") &&
      inDateRange(r.invoice_date, filters.from, filters.to),
  );
  const returnsF = saleReturns.filter((r) =>
    inDateRange(r.return_date || r.doc_date, filters.from, filters.to),
  );
  const purchasesF = purchases.filter(
    (r) =>
      (!r.status || r.status === "posted") &&
      inDateRange(r.invoice_date, filters.from, filters.to),
  );
  const purchaseReturnsF = purchaseReturns.filter((r) =>
    inDateRange(r.return_date || r.doc_date, filters.from, filters.to),
  );
  const expensesF = expenses.filter((r) =>
    inDateRange(r.expense_date || r.doc_date, filters.from, filters.to),
  );
  const expiryCreditsF = expiryReceipts.filter((r) =>
    inDateRange(r.receipt_date || r.doc_date, filters.from, filters.to),
  );
  const expiryClaimsF = expiryClaims.filter((r) =>
    inDateRange(r.claim_date || r.doc_date, filters.from, filters.to),
  );

  const salesTotal = salesF.reduce((s, r) => s + num(r.grand_total), 0);
  const returnsTotal = returnsF.reduce((s, r) => s + num(r.grand_total), 0);
  const expiryCredits = expiryCreditsF.reduce(
    (s, r) => s + num(r.grand_total ?? r.amount),
    0,
  );
  const expiryVendor = expiryClaimsF.reduce(
    (s, r) => s + num(r.grand_total ?? r.amount),
    0,
  );
  const purchasesGross = purchasesF.reduce((s, r) => s + num(r.grand_total), 0);
  const purchaseTrade = purchasesF.reduce((s, r) => s + num(r.discount_total), 0);
  const purchaseExtra = purchasesF.reduce((s, r) => s + num(r.extra_discount), 0);
  const purchaseReturnsTotal = purchaseReturnsF.reduce(
    (s, r) => s + num(r.grand_total),
    0,
  );

  let cogs = 0;
  for (const inv of salesF) {
    const lines = Array.isArray(inv.lines)
      ? (inv.lines as Record<string, unknown>[])
      : Array.isArray((inv.payload as Record<string, unknown> | undefined)?.items)
        ? (((inv.payload as Record<string, unknown>).items as Record<string, unknown>[]) || [])
        : [];
    if (lines.length) {
      for (const line of lines) {
        const qty = num(line.qty) + num(line.bonus_qty || line.bonus);
        const cost = costByProduct.get(String(line.product_id)) || 0;
        cogs += qty * cost;
      }
    } else {
      // Fallback when line costs unavailable: ~70% of invoice
      cogs += num(inv.grand_total) * 0.7;
    }
  }

  let salary = 0;
  let otherExpenses = 0;
  const byCategory = new Map<string, number>();
  for (const e of expensesF) {
    const amt = num(e.amount ?? e.total_amount);
    const cat = String(e.category || "other");
    byCategory.set(cat, (byCategory.get(cat) || 0) + amt);
    if (cat === "salary") salary += amt;
    else otherExpenses += amt;
  }
  const expensesTotal = salary + otherExpenses;

  const netSales = salesTotal - returnsTotal - expiryCredits;
  const grossProfit = netSales - cogs;
  const netProfit = grossProfit + expiryVendor - expensesTotal;
  const purchasesNet = purchasesGross - purchaseReturnsTotal;

  const daily = new Map<
    string,
    { day: string; sales: number; returns: number; expiry_credits: number; net_sales: number; expenses: number }
  >();
  const touch = (day: string) => {
    if (!daily.has(day)) {
      daily.set(day, {
        day,
        sales: 0,
        returns: 0,
        expiry_credits: 0,
        net_sales: 0,
        expenses: 0,
      });
    }
    return daily.get(day)!;
  };
  for (const r of salesF) {
    const d = String(r.invoice_date).slice(0, 10);
    const row = touch(d);
    row.sales += num(r.grand_total);
    row.net_sales += num(r.grand_total);
  }
  for (const r of returnsF) {
    const d = String(r.return_date || r.doc_date).slice(0, 10);
    const row = touch(d);
    row.returns += num(r.grand_total);
    row.net_sales -= num(r.grand_total);
  }
  for (const r of expiryCreditsF) {
    const d = String(r.receipt_date || r.doc_date).slice(0, 10);
    const amt = num(r.grand_total ?? r.amount);
    const row = touch(d);
    row.expiry_credits += amt;
    row.net_sales -= amt;
  }
  for (const r of expensesF) {
    const d = String(r.expense_date || r.doc_date).slice(0, 10);
    touch(d).expenses += num(r.amount ?? r.total_amount);
  }

  return {
    from: filters.from || "",
    to: filters.to || "",
    sales: salesTotal,
    returns: returnsTotal,
    expiry_credits: expiryCredits,
    expiry_claims: expiryVendor,
    expiry_rejects: 0,
    expiry_vendor_net: expiryVendor,
    net_sales: netSales,
    cogs,
    gross_profit: grossProfit,
    expenses: expensesTotal,
    salary,
    other_expenses: otherExpenses,
    net_profit: netProfit,
    gross_margin_pct: netSales > 0 ? (grossProfit / netSales) * 100 : 0,
    net_margin_pct: netSales > 0 ? (netProfit / netSales) * 100 : 0,
    purchases_gross: purchasesGross,
    purchase_returns: purchaseReturnsTotal,
    purchases: purchasesNet,
    purchase_trade_discount: purchaseTrade,
    purchase_extra_discount: purchaseExtra,
    purchase_discounts: purchaseTrade + purchaseExtra,
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
    expenses_by_category: [...byCategory.entries()].map(([category, amount]) => ({
      category,
      amount,
      label: category,
    })),
    note: "Offline estimate — COGS uses local purchase rates when line items exist.",
  };
}

/** Salesman running book from local sales / recoveries / expenses. */
export async function offlineSalesmanLedger(input: {
  companyId: string;
  salesmanId: string;
  from?: string | null;
  to?: string | null;
}) {
  const empty = {
    salesmanName: "",
    lines: [] as Array<{
      date: string;
      type: string;
      particulars: string;
      sales: number;
      collected: number;
      expense: number;
      running: number;
    }>,
    totals: {
      sales: 0,
      collected: 0,
      salary: 0,
      otherExpenses: 0,
      expenses: 0,
      netCash: 0,
    },
  };
  if (!input.salesmanId) return empty;

  const [salesmen, sales, vouchers, expenses] = await loadMultipleRows(
    ["salesmen", "sale_invoices", "vouchers", "expenses"],
    input.companyId,
  );

  const salesman =
    salesmen.find((s) => String(s.id) === input.salesmanId) ||
    salesmen.find((s) => String(s.user_id) === input.salesmanId);
  const salesmanName = String(
    salesman?.full_name || salesman?.name || "Salesman",
  );

  type Draft = {
    date: string;
    type: string;
    particulars: string;
    sales: number;
    collected: number;
    expense: number;
  };
  const drafts: Draft[] = [];
  const totals = { ...empty.totals };

  for (const inv of sales) {
    if (
      String(inv.salesman_id || "") !== input.salesmanId &&
      String(inv.salesman_id || "") !== String(salesman?.id || "")
    ) {
      continue;
    }
    if (!inDateRange(inv.invoice_date, input.from, input.to)) continue;
    const salesAmt = num(inv.grand_total);
    const paid = num(inv.amount_paid);
    totals.sales += salesAmt;
    totals.collected += paid;
    drafts.push({
      date: String(inv.invoice_date || "").slice(0, 10),
      type: "Sale",
      particulars: `${inv.invoice_no || inv.id} — ${partyLabel(inv)}`,
      sales: salesAmt,
      collected: paid,
      expense: 0,
    });
  }

  for (const r of vouchers) {
    const type = String(r.voucher_type || r.type || r.entity_type || "");
    const isRecovery =
      type === "recovery" || type === "cash_receipt" || type === "CR";
    if (!isRecovery) continue;
    if (
      String(r.salesman_id || "") !== input.salesmanId &&
      String(r.salesman_id || "") !== String(salesman?.id || "")
    ) {
      continue;
    }
    if (!inDateRange(r.voucher_date || r.doc_date || r.recovery_date, input.from, input.to)) {
      continue;
    }
    const amt = num(r.amount ?? r.total_amount ?? r.grand_total);
    totals.collected += amt;
    drafts.push({
      date: String(r.voucher_date || r.doc_date || r.recovery_date || "").slice(0, 10),
      type: "Recovery",
      particulars: `${partyLabel(r)}${r.remarks ? ` — ${r.remarks}` : ""}`,
      sales: 0,
      collected: amt,
      expense: 0,
    });
  }

  for (const e of expenses) {
    if (
      String(e.salesman_id || "") !== input.salesmanId &&
      String(e.salesman_id || "") !== String(salesman?.id || "")
    ) {
      continue;
    }
    if (!inDateRange(e.expense_date || e.doc_date, input.from, input.to)) continue;
    const amt = num(e.amount ?? e.total_amount);
    const isSalary = String(e.category) === "salary";
    if (isSalary) totals.salary += amt;
    else totals.otherExpenses += amt;
    totals.expenses += amt;
    drafts.push({
      date: String(e.expense_date || e.doc_date || "").slice(0, 10),
      type: isSalary ? "Salary" : "Expense",
      particulars: `${e.expense_no || e.doc_no || e.id} — ${e.category || "expense"}`,
      sales: 0,
      collected: 0,
      expense: amt,
    });
  }

  drafts.sort((a, b) => a.date.localeCompare(b.date));
  let running = 0;
  const lines = drafts.map((row) => {
    running += row.collected - row.expense;
    return { ...row, running };
  });
  totals.netCash = totals.collected - totals.expenses;

  return { salesmanName, lines, totals };
}

export async function offlineSalesmenOptions(companyId: string) {
  const rows = await loadRows("salesmen", companyId);
  return rows.map((s) => ({
    id: String(s.id || s.user_id || ""),
    user_id: String(s.user_id || s.id || ""),
    full_name: String(s.full_name || s.name || "Salesman"),
  })).filter((s) => s.id);
}

export async function offlinePartiesOptions(companyId: string) {
  const rows = await loadRows("parties", companyId);
  return rows
    .filter((p) => p.is_active !== false)
    .map((p) => ({
      id: String(p.id),
      party_code: String(p.party_code || ""),
      name_en: String(p.name_en || ""),
    }))
    .filter((p) => p.id)
    .sort((a, b) => a.name_en.localeCompare(b.name_en));
}

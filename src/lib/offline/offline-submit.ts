import { createClient } from "@/lib/supabase/client";
import {
  enqueueMutation,
  putCachedRow,
  addStockDelta,
  getCachedRows,
  listPendingMutations,
  updateMutation,
  type OfflineMutationType,
  type CacheStoreName,
  type SyncStatus,
} from "@/lib/offline/local-db";
import { isAppOnline } from "@/lib/offline/local-auth";
import {
  hasLocalSqlite,
  localSavePurchaseInvoice,
  localSaveSaleInvoice,
  localSaveDocument,
  localUpsertMaster,
  localListMaster,
  localListDocuments,
  localListByEntity,
  localBulkUpsertStockBalances,
} from "@/lib/offline/sqlite-client";

// ── RPC name mapping ────────────────────────────────────────────────

const MUTATION_RPC_MAP: Record<string, string> = {
  recovery: "record_recovery",
  sale_invoice: "create_sale_invoice",
  purchase_invoice: "create_purchase_invoice",
  sale_return: "create_sale_return",
  purchase_return: "create_purchase_return",
  cash_receipt: "create_cash_receipt",
  cash_payment: "create_cash_payment",
  journal_voucher: "create_journal_voucher",
  stock_transfer: "create_stock_transfer",
  gate_pass: "create_gate_pass",
  load_sheet: "create_load_sheet",
  expense: "create_expenses",
  expiry_receipt: "create_expiry_receipt",
  expiry_claim: "create_expiry_claim",
  expiry_settle: "settle_expiry_claim",
  salesman_invite: "create_salesman_invite",
};

/** Server rejected the write for a real business reason — do not queue offline. */
export function isBusinessRuleError(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("insufficient stock") ||
    m.includes("insufficient expiry") ||
    m.includes("no write access") ||
    m.includes("credit limit") ||
    m.includes("add at least one") ||
    m.includes("already exists") ||
    m.includes("duplicate key") ||
    m.includes("unique constraint")
  );
}

function isNetworkishError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err || "");
  const m = message.toLowerCase();
  return (
    m.includes("failed to fetch") ||
    m.includes("network") ||
    m.includes("timed out") ||
    m.includes("timeout") ||
    m.includes("fetch failed") ||
    m.includes("offline") ||
    m.includes("authretryable") ||
    m.includes("failed to fetch")
  );
}

// ── Types ───────────────────────────────────────────────────────────

export type OfflineSubmitResult = {
  /** Server-assigned or local ID */
  id: string;
  /** Where the data was saved */
  source: "server" | "offline";
  /** User-facing message */
  message: string;
};

export type OfflineSubmitParams = {
  mutationType: OfflineMutationType;
  /** Payload passed to the RPC as p_payload */
  payload: Record<string, unknown>;
  companyId: string;
  organizationId: string;
  /** Override to force offline even when navigator reports online */
  forceOffline?: boolean;
  /** Local document number for display before sync (e.g. "LOCAL-SI-001") */
  localDocNo?: string;
  /** Stock changes to track locally (for sale/purchase/return/transfer) */
  stockChanges?: Array<{
    productId: string;
    warehouseId: string;
    delta: number;
  }>;
  /** Optional: cache store to optimistically write the new record */
  cacheStore?: string;
  /** Optional: the record to optimistically cache */
  cacheRecord?: Record<string, unknown>;
};

// ── Main function ───────────────────────────────────────────────────

/**
 * Universal offline-aware submit handler.
 *
 * - If online: calls the Supabase RPC directly, returns server ID
 * - If offline (or online call fails): queues mutation in IndexedDB, returns local ID
 * - Desktop: also persists sale/purchase into SQLite ledger + outbox
 */
export async function offlineAwareSubmit(
  params: OfflineSubmitParams,
): Promise<OfflineSubmitResult> {
  const {
    mutationType,
    payload,
    companyId,
    forceOffline,
    localDocNo,
    stockChanges,
    cacheStore,
    cacheRecord,
  } = params;

  const online =
    !forceOffline && (await isAppOnline().catch(() => navigator.onLine));

  // ── Try online first ────────────────────────────────────────────
  if (online) {
    try {
      const result = await Promise.race([
        submitOnline(mutationType, payload),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Online submit timed out")), 12000),
        ),
      ]);

      // Mirror successful cloud writes into local SQLite for offline continuity.
      if (hasLocalSqlite()) {
        await persistMutationToSqlite({
          mutationType,
          payload,
          companyId,
          documentId: result.id,
          syncStatus: "synced",
          stockChanges,
          enqueueOutbox: false,
        }).catch((err) =>
          console.warn("[offlineAwareSubmit] SQLite mirror failed:", err),
        );
      }

      return {
        id: result.id,
        source: "server",
        message: getSuccessMessage(mutationType),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Real validation from the server must surface to the user — not hide in the offline queue.
      if (isBusinessRuleError(message) && !isNetworkishError(err)) {
        throw err instanceof Error ? err : new Error(message);
      }
      console.warn(
        `[offlineAwareSubmit] Online ${mutationType} failed, queueing offline:`,
        err,
      );
    }
  }

  // ── Queue offline ───────────────────────────────────────────────
  const localId =
    localDocNo || (await allocateSequentialDocNo(mutationType, companyId));
  const documentId =
    (typeof payload.id === "string" && payload.id) ||
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `doc-${Date.now()}`);

  // Desktop SQLite is the durable offline ledger for all ERP writes.
  if (hasLocalSqlite()) {
    const sqlite = await persistMutationToSqlite({
      mutationType,
      payload: { ...payload, invoice_no: localId, doc_no: localId },
      companyId,
      documentId,
      syncStatus: "pending",
      stockChanges,
      enqueueOutbox: true,
      localDocNo: localId,
    });
    if (!sqlite.ok) {
      throw new Error(sqlite.error || "Failed to save locally");
    }
  }

  const mutation = await enqueueMutation({
    companyId,
    type: mutationType,
    payload: { ...payload, id: documentId, invoice_no: localId, doc_no: localId },
    localId,
  });

  // Track stock deltas locally (IndexedDB) for UI stock checks
  if (stockChanges && stockChanges.length > 0) {
    for (const change of stockChanges) {
      await addStockDelta({
        companyId,
        productId: change.productId,
        warehouseId: change.warehouseId,
        delta: change.delta,
        mutationId: mutation.id,
      });
    }
  }

  // Optimistically write to cache so the record appears in offline lists
  const cacheTarget = resolveCacheStore(mutationType, cacheStore);
  if (cacheTarget) {
    await putCachedRow(
      cacheTarget,
      companyId,
      {
        ...(cacheRecord || payload),
        id: documentId,
        company_id: companyId,
        invoice_no: localId,
        doc_no: localId,
        _localId: localId,
        party_name:
          (payload.party_name as string) ||
          (cacheRecord?.party_name as string) ||
          null,
        party_code:
          (payload.party_code as string) ||
          (cacheRecord?.party_code as string) ||
          null,
        parties: payload.parties || cacheRecord?.parties || null,
        status: "posted",
      },
      "pending",
    );
  }

  return {
    id: documentId || mutation.id,
    source: "offline",
    message: getSuccessMessage(mutationType),
  };
}

function resolveCacheStore(
  mutationType: OfflineMutationType,
  cacheStore?: string,
):
  | "sale_invoices"
  | "purchase_invoices"
  | "sale_returns"
  | "purchase_returns"
  | "vouchers"
  | "expenses"
  | "stock_transfers"
  | "gate_passes"
  | "load_sheets"
  | "expiry_receipts"
  | "expiry_claims"
  | "parties"
  | "products"
  | "warehouses"
  | "salesmen"
  | null {
  if (cacheStore) return cacheStore as never;
  const map: Partial<Record<OfflineMutationType, string>> = {
    sale_invoice: "sale_invoices",
    purchase_invoice: "purchase_invoices",
    sale_return: "sale_returns",
    purchase_return: "purchase_returns",
    recovery: "vouchers",
    cash_receipt: "vouchers",
    cash_payment: "vouchers",
    journal_voucher: "vouchers",
    expense: "expenses",
    stock_transfer: "stock_transfers",
    gate_pass: "gate_passes",
    load_sheet: "load_sheets",
    expiry_receipt: "expiry_receipts",
    expiry_claim: "expiry_claims",
    party_create: "parties",
    party_update: "parties",
    product_create: "products",
    product_update: "products",
    warehouse_create: "warehouses",
    warehouse_update: "warehouses",
    salesman_create: "salesmen",
    salesman_update: "salesmen",
  };
  return (map[mutationType] as never) || null;
}

async function persistMutationToSqlite(opts: {
  mutationType: OfflineMutationType;
  payload: Record<string, unknown>;
  companyId: string;
  documentId: string;
  syncStatus: "pending" | "synced";
  stockChanges?: OfflineSubmitParams["stockChanges"];
  enqueueOutbox: boolean;
  localDocNo?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const syncStatus = opts.enqueueOutbox ? opts.syncStatus : "synced";
  const base = {
    ...opts.payload,
    id: opts.documentId,
    company_id: opts.companyId,
    sync_status: syncStatus,
  };

  // Master data
  if (
    opts.mutationType === "party_create" ||
    opts.mutationType === "party_update"
  ) {
    return localUpsertMaster("parties", base);
  }
  if (
    opts.mutationType === "product_create" ||
    opts.mutationType === "product_update"
  ) {
    return localUpsertMaster("products", base);
  }
  if (
    opts.mutationType === "warehouse_create" ||
    opts.mutationType === "warehouse_update"
  ) {
    return localUpsertMaster("warehouses", base);
  }
  if (
    opts.mutationType === "salesman_create" ||
    opts.mutationType === "salesman_update"
  ) {
    return localUpsertMaster("salesmen", {
      ...base,
      name:
        (opts.payload.full_name as string | undefined) ||
        (opts.payload.name as string | undefined) ||
        null,
    });
  }

  // Sale / purchase typed tables
  if (
    opts.mutationType === "sale_invoice" ||
    opts.mutationType === "purchase_invoice"
  ) {
    const items = Array.isArray(opts.payload.items)
      ? (opts.payload.items as Record<string, unknown>[])
      : [];
    const lines = items.map((item, idx) => ({
      id: String(item.id || `${opts.documentId}-L${idx + 1}`),
      product_id: item.product_id,
      qty: Number(item.qty || 0) + Number(item.bonus_qty || 0),
      rate: Number(item.rate || 0),
      amount: Number(item.amount || 0),
      ...item,
    }));
    const doc = {
      ...base,
      invoice_no:
        opts.localDocNo ||
        (opts.payload.invoice_no as string | undefined) ||
        null,
      invoice_date: opts.payload.invoice_date,
      party_id: opts.payload.party_id,
      warehouse_id: opts.payload.warehouse_id,
      payment_type: opts.payload.payment_type,
      status: "posted",
      grand_total: Number(opts.payload.grand_total || 0),
      lines,
    };
    const result =
      opts.mutationType === "sale_invoice"
        ? await localSaveSaleInvoice(doc)
        : await localSavePurchaseInvoice(doc);
    if (!result.ok) return result;
    if (opts.stockChanges?.length) {
      await applyStockChangesToSqlite(opts.companyId, opts.stockChanges);
    }
    return { ok: true };
  }

  // All other ERP documents → generic local_documents
  const result = await localSaveDocument({
    id: opts.documentId,
    company_id: opts.companyId,
    entity_type: opts.mutationType,
    doc_no:
      opts.localDocNo ||
      (opts.payload.invoice_no as string | undefined) ||
      (opts.payload.doc_no as string | undefined) ||
      null,
    doc_date:
      (opts.payload.invoice_date as string | undefined) ||
      (opts.payload.doc_date as string | undefined) ||
      (opts.payload.expense_date as string | undefined) ||
      (opts.payload.voucher_date as string | undefined) ||
      new Date().toISOString().slice(0, 10),
    party_id: opts.payload.party_id || null,
    status: (opts.payload.status as string | undefined) || "posted",
    amount: Number(
      opts.payload.grand_total ??
        opts.payload.amount ??
        opts.payload.total_amount ??
        0,
    ),
    sync_status: syncStatus,
    enqueue_outbox: opts.enqueueOutbox,
    payload: base,
  });

  if (!result.ok) return result;
  if (opts.stockChanges?.length) {
    await applyStockChangesToSqlite(opts.companyId, opts.stockChanges);
  }
  return { ok: true };
}

async function applyStockChangesToSqlite(
  companyId: string,
  changes: NonNullable<OfflineSubmitParams["stockChanges"]>,
) {
  const listed = await localListMaster("stock_balances", companyId, 20000);
  const rows = listed.rows || [];
  const byKey = new Map<string, Record<string, unknown>>(
    rows.map((r) => [`${r.product_id}:${r.warehouse_id}`, r]),
  );

  const upserts: Record<string, unknown>[] = [];
  for (const change of changes) {
    const key = `${change.productId}:${change.warehouseId}`;
    const existing = byKey.get(key);
    const nextQty = Number(existing?.qty || 0) + change.delta;
    const id =
      (existing?.id as string | undefined) ||
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `stock-${companyId}-${change.productId}-${change.warehouseId}`);

    upserts.push({
      id,
      company_id: companyId,
      product_id: change.productId,
      warehouse_id: change.warehouseId,
      qty: nextQty,
      sync_status: "pending",
      updated_at: new Date().toISOString(),
    });
  }

  // Single IPC call for all stock changes (was N individual calls)
  await localBulkUpsertStockBalances(companyId, upserts);
}

// ── Online submit via RPC ───────────────────────────────────────────

async function submitOnline(
  mutationType: OfflineMutationType,
  payload: Record<string, unknown>,
): Promise<{ id: string }> {
  const supabase = createClient();

  // ── Direct table operations (not RPC) ───────────────────────────
  if (mutationType === "party_create") {
    const { data, error } = await supabase
      .from("parties")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id };
  }

  if (mutationType === "party_update") {
    const id = payload.id as string;
    const rest = { ...payload };
    delete rest.id;
    const { error } = await supabase.from("parties").update(rest).eq("id", id);
    if (error) throw new Error(error.message);
    return { id };
  }

  if (mutationType === "product_create") {
    const rpcName = "create_product";
    const { data, error } = await supabase.rpc(rpcName, {
      p_payload: payload,
    });
    if (error) throw new Error(error.message);
    return { id: String(data) };
  }

  if (mutationType === "product_update") {
    const rpcName = "update_product";
    const id = (payload.id as string) || (payload.p_id as string);
    const rest = { ...payload };
    delete rest.id;
    delete rest.p_id;
    const { data, error } = await supabase.rpc(rpcName, {
      p_id: id,
      p_payload: rest,
    });
    if (error) throw new Error(error.message);
    return { id: String(data || id) };
  }

  if (mutationType === "warehouse_create") {
    const { data, error } = await supabase
      .from("warehouses")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id };
  }

  if (mutationType === "warehouse_update") {
    const id = payload.id as string;
    const rest = { ...payload };
    delete rest.id;
    const { error } = await supabase.from("warehouses").update(rest).eq("id", id);
    if (error) throw new Error(error.message);
    return { id };
  }

  if (mutationType === "salesman_create") {
    const { data, error } = await supabase
      .from("salesmen")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id };
  }

  if (mutationType === "salesman_update") {
    const id = payload.id as string;
    const rest = { ...payload };
    delete rest.id;
    const { error } = await supabase.from("salesmen").update(rest).eq("id", id);
    if (error) throw new Error(error.message);
    return { id };
  }

  // ── RPC-based operations ────────────────────────────────────────
  const rpcName = MUTATION_RPC_MAP[mutationType];
  if (!rpcName) {
    throw new Error(`No RPC mapping for mutation type: ${mutationType}`);
  }

  const { data, error } = await supabase.rpc(rpcName, {
    p_payload: payload,
  });

  if (error) throw new Error(error.message);
  return { id: String(data || "") };
}

// ── Helpers ─────────────────────────────────────────────────────────

function getSuccessMessage(type: OfflineMutationType): string {
  const messages: Record<string, string> = {
    recovery: "Recovery posted successfully.",
    sale_invoice: "Sale invoice created.",
    purchase_invoice: "Purchase invoice created.",
    sale_return: "Sale return created.",
    purchase_return: "Purchase return created.",
    cash_receipt: "Cash receipt posted.",
    cash_payment: "Cash payment posted.",
    journal_voucher: "Journal voucher posted.",
    stock_transfer: "Stock transfer posted.",
    gate_pass: "Gate pass created.",
    load_sheet: "Load sheet created.",
    expense: "Expense recorded.",
    party_create: "Party created.",
    party_update: "Party updated.",
    product_create: "Product created.",
    product_update: "Product updated.",
    warehouse_create: "Warehouse created.",
    salesman_create: "Salesman created.",
    salesman_update: "Salesman updated.",
    expiry_receipt: "Expiry receipt created.",
    expiry_claim: "Expiry claim created.",
    expiry_settle: "Expiry claim settled.",
    salesman_invite: "Salesman invite created.",
  };
  return messages[type] || "Saved successfully.";
}

/**
 * Online-equivalent document series configuration.
 * Uses the exact same prefixes and 4-digit zero padding as Supabase next_document_no.
 */
export const SERIES_CONFIG: Record<
  string,
  { prefix: string; pad: number; store: CacheStoreName }
> = {
  sale_invoice: { prefix: "SI-", pad: 0, store: "sale_invoices" },
  purchase_invoice: { prefix: "PI-", pad: 0, store: "purchase_invoices" },
  sale_return: { prefix: "SR-", pad: 0, store: "sale_returns" },
  purchase_return: { prefix: "PR-", pad: 0, store: "purchase_returns" },
  stock_transfer: { prefix: "ST-", pad: 0, store: "stock_transfers" },
  load_sheet: { prefix: "LD-", pad: 0, store: "load_sheets" },
  gate_pass: { prefix: "GP-", pad: 0, store: "gate_passes" },
  cash_receipt: { prefix: "CR-", pad: 0, store: "vouchers" },
  recovery: { prefix: "CR-", pad: 0, store: "vouchers" },
  cash_payment: { prefix: "CP-", pad: 0, store: "vouchers" },
  journal_voucher: { prefix: "JV-", pad: 0, store: "vouchers" },
  expense: { prefix: "EXP-", pad: 0, store: "expenses" },
  expiry_receipt: { prefix: "EXR-", pad: 0, store: "expiry_receipts" },
  expiry_claim: { prefix: "CLM-", pad: 0, store: "expiry_claims" },
  expiry_settle: { prefix: "SET-", pad: 0, store: "expiry_claims" },
};

function parseNumberForPrefix(value: unknown, prefix: string): number | null {
  if (typeof value !== "string" || !value) return null;
  const clean = value.trim();
  const basePrefix = prefix.replace(/[-_]$/, "");
  const escaped = basePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escaped}[-_]?(\\d+)$`, "i");
  const m = clean.match(regex);
  if (m) {
    const num = parseInt(m[1], 10);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

/**
 * Allocate sequential document numbers (e.g. SI-0024, SI-0025)
 * matching the online document series without any "LOCAL-" prefix.
 */
export async function allocateSequentialDocNo(
  mutationType: OfflineMutationType,
  companyId: string,
): Promise<string> {
  const cfg = SERIES_CONFIG[mutationType] || {
    prefix: "DOC-",
    pad: 4,
    store: "sale_invoices" as CacheStoreName,
  };
  const { prefix, pad, store } = cfg;

  let maxFound = 0;

  // 1. Check local storage bookmark
  const storageKey = `doc_seq_${companyId}_${prefix}`;
  if (typeof window !== "undefined" && window.localStorage) {
    const stored = parseInt(window.localStorage.getItem(storageKey) || "0", 10);
    if (Number.isFinite(stored) && stored > maxFound) {
      maxFound = stored;
    }
  }

  // 2. Check desktop SQLite if available
  if (hasLocalSqlite()) {
    try {
      if (mutationType === "sale_invoice" || mutationType === "purchase_invoice") {
        const table =
          mutationType === "sale_invoice" ? "sale_invoices" : "purchase_invoices";
        const docs = await localListDocuments(table, companyId, 5000);
        for (const row of docs.rows || []) {
          const n = parseNumberForPrefix(row.invoice_no, prefix);
          if (n !== null && n > maxFound) maxFound = n;
        }
      } else {
        const docs = await localListByEntity(companyId, mutationType, 5000);
        for (const row of docs.rows || []) {
          const n =
            parseNumberForPrefix(row.doc_no, prefix) ??
            parseNumberForPrefix(row.invoice_no, prefix);
          if (n !== null && n > maxFound) maxFound = n;
        }
      }
    } catch (e) {
      console.warn("[allocateSequentialDocNo] sqlite scan failed:", e);
    }
  }

  // 3. Check IndexedDB cached rows
  try {
    const cached = await getCachedRows(store, companyId);
    for (const row of cached) {
      const n =
        parseNumberForPrefix(row.invoice_no, prefix) ??
        parseNumberForPrefix(row.doc_no, prefix) ??
        parseNumberForPrefix(row.voucher_no, prefix) ??
        parseNumberForPrefix(row.receipt_no, prefix) ??
        parseNumberForPrefix(row.claim_no, prefix) ??
        parseNumberForPrefix(row.pass_no, prefix) ??
        parseNumberForPrefix(row.sheet_no, prefix) ??
        parseNumberForPrefix(row.transfer_no, prefix) ??
        parseNumberForPrefix(row.expense_no, prefix) ??
        parseNumberForPrefix(row._localId, prefix);
      if (n !== null && n > maxFound) maxFound = n;
    }
  } catch (e) {
    console.warn("[allocateSequentialDocNo] idb cache scan failed:", e);
  }

  // 4. Check pending mutations
  try {
    const pending = await listPendingMutations(companyId);
    for (const m of pending) {
      if (m.type === mutationType) {
        const n =
          parseNumberForPrefix(m.localId, prefix) ??
          parseNumberForPrefix(m.payload?.invoice_no, prefix) ??
          parseNumberForPrefix(m.payload?.doc_no, prefix);
        if (n !== null && n > maxFound) maxFound = n;
      }
    }
  } catch (e) {
    console.warn("[allocateSequentialDocNo] idb mutations scan failed:", e);
  }

  const nextNum = maxFound + 1;
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(storageKey, String(nextNum));
    } catch {}
  }

  return `${prefix}${pad > 0 ? String(nextNum).padStart(pad, "0") : nextNum}`;
}

/**
 * Automatically migrate and clean up any historical "LOCAL-" document numbers
 * (e.g. LOCAL-SALE_INVOICE-1789545915342) into continuous online serials (e.g. SI-0024).
 */
export async function migrateLegacyLocalDocNos(companyId: string): Promise<void> {
  if (!companyId) return;

  const storesToCheck: CacheStoreName[] = [
    "sale_invoices",
    "purchase_invoices",
    "sale_returns",
    "purchase_returns",
    "vouchers",
    "expenses",
    "stock_transfers",
    "gate_passes",
    "load_sheets",
    "expiry_receipts",
    "expiry_claims",
  ];

  const typeMap: Record<string, OfflineMutationType> = {
    sale_invoices: "sale_invoice",
    purchase_invoices: "purchase_invoice",
    sale_returns: "sale_return",
    purchase_returns: "purchase_return",
    vouchers: "cash_receipt",
    expenses: "expense",
    stock_transfers: "stock_transfer",
    gate_passes: "gate_pass",
    load_sheets: "load_sheet",
    expiry_receipts: "expiry_receipt",
    expiry_claims: "expiry_claim",
  };

  try {
    for (const store of storesToCheck) {
      const rows = await getCachedRows(store, companyId);
      const legacyRows = rows.filter((r) => {
        const idStr = String(
          r.invoice_no || r.doc_no || r.voucher_no || r._localId || r.id || "",
        );
        return idStr.startsWith("LOCAL-");
      });

      if (legacyRows.length === 0) continue;

      // Sort chronologically
      legacyRows.sort((a, b) => {
        const strA = String(a.invoice_no || a.doc_no || a._localId || a.id || "");
        const strB = String(b.invoice_no || b.doc_no || b._localId || b.id || "");
        const matchA = strA.match(/(\d{10,16})/);
        const matchB = strB.match(/(\d{10,16})/);
        const numA = matchA ? parseInt(matchA[1], 10) : 0;
        const numB = matchB ? parseInt(matchB[1], 10) : 0;
        return numA - numB;
      });

      const mType = typeMap[store] || "sale_invoice";

      for (const row of legacyRows) {
        const newDocNo = await allocateSequentialDocNo(mType, companyId);
        const oldId = String(
          row.invoice_no || row.doc_no || row.voucher_no || row._localId || row.id,
        );

        const updatedRow = {
          ...row,
          invoice_no: newDocNo,
          doc_no: newDocNo,
          _localId: newDocNo,
        };

        await putCachedRow(
          store,
          companyId,
          updatedRow,
          (row._syncStatus as SyncStatus) || "pending",
        );

        if (hasLocalSqlite()) {
          try {
            if (store === "sale_invoices") {
              await localSaveSaleInvoice({
                ...updatedRow,
                id: String(row.id),
                invoice_no: newDocNo,
              });
            } else if (store === "purchase_invoices") {
              await localSavePurchaseInvoice({
                ...updatedRow,
                id: String(row.id),
                invoice_no: newDocNo,
              });
            } else {
              await localSaveDocument({
                id: String(row.id),
                company_id: companyId,
                entity_type: mType,
                doc_no: newDocNo,
                doc_date: String(
                  row.invoice_date ||
                    row.doc_date ||
                    new Date().toISOString().slice(0, 10),
                ),
                party_id: (row.party_id as string) || null,
                status: "posted",
                amount: Number(row.grand_total ?? row.amount ?? 0),
                sync_status:
                  (row._syncStatus as "pending" | "synced") || "pending",
                enqueue_outbox: false,
                payload: updatedRow,
              });
            }
          } catch (err) {
            console.warn("[migrateLegacyLocalDocNos] SQLite write failed:", err);
          }
        }

        try {
          const pending = await listPendingMutations(companyId);
          for (const m of pending) {
            if (
              m.localId === oldId ||
              m.payload?.invoice_no === oldId ||
              m.payload?.doc_no === oldId ||
              m.payload?.id === row.id
            ) {
              await updateMutation(m.id, {
                localId: newDocNo,
                payload: {
                  ...m.payload,
                  invoice_no: newDocNo,
                  doc_no: newDocNo,
                  _localId: newDocNo,
                },
              });
            }
          }
        } catch {}
      }
    }
  } catch (err) {
    console.warn("[migrateLegacyLocalDocNos] failed:", err);
  }
}

/**
 * Allocate sequential numeric party code (e.g. 1024, 1025)
 * matching the online distributor master pattern.
 */
export async function allocateNextPartyCode(companyId: string): Promise<string> {
  let maxCode = 1000;
  if (hasLocalSqlite()) {
    try {
      const res = await localListMaster("parties", companyId, 5000);
      for (const p of res.rows || []) {
        const code = String(p.code || p.party_code || "").trim();
        if (/^\d+$/.test(code)) {
          const n = parseInt(code, 10);
          if (n > maxCode) maxCode = n;
        }
      }
    } catch {}
  }
  try {
    const cached = await getCachedRows("parties", companyId);
    for (const p of cached) {
      const code = String(p.party_code || p.code || "").trim();
      if (/^\d+$/.test(code)) {
        const n = parseInt(code, 10);
        if (n > maxCode) maxCode = n;
      }
    }
  } catch {}
  return String(maxCode + 1);
}

/**
 * Allocate sequential numeric product code (e.g. 1053, 1054)
 * matching the online distributor inventory master pattern.
 */
export async function allocateNextProductCode(companyId: string): Promise<string> {
  let maxCode = 1000;
  if (hasLocalSqlite()) {
    try {
      const res = await localListMaster("products", companyId, 5000);
      for (const p of res.rows || []) {
        const code = String(p.code || "").trim();
        if (/^\d+$/.test(code)) {
          const n = parseInt(code, 10);
          if (n > maxCode) maxCode = n;
        }
      }
    } catch {}
  }
  try {
    const cached = await getCachedRows("products", companyId);
    for (const p of cached) {
      const code = String(p.code || "").trim();
      if (/^\d+$/.test(code)) {
        const n = parseInt(code, 10);
        if (n > maxCode) maxCode = n;
      }
    }
  } catch {}
  return String(maxCode + 1);
}

/**
 * Clean numeric or sequential fallback document number.
 */
export function generateLocalDocNo(prefix: string): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${date}-${rand}`;
}


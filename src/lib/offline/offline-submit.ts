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
  recovery_batch: "record_recovery_batch",
  sale_invoice: "create_sale_invoice",
  purchase_invoice: "create_purchase_invoice",
  sale_return: "create_sale_return",
  purchase_return: "create_purchase_return",
  cash_receipt: "create_cash_receipt",
  cash_payment: "create_cash_payment",
  journal_voucher: "create_journal_voucher",
  stock_transfer: "create_stock_transfer",
  gate_pass: "create_gate_pass",
  gate_pass_update: "update_gate_pass",
  load_sheet: "create_load_sheet",
  expense: "create_expenses",
  expiry_receipt: "create_expiry_receipt",
  expiry_claim: "create_expiry_claim",
  expiry_settle: "settle_expiry_claim",
  salesman_invite: "create_salesman_invite",
  sale_invoice_update: "update_sale_invoice",
  purchase_invoice_update: "update_purchase_invoice",
  sale_return_update: "update_sale_return",
  purchase_return_update: "update_purchase_return",
  cash_receipt_update: "update_cash_receipt",
  cash_payment_update: "update_cash_payment",
  journal_voucher_update: "update_journal_voucher",
  recovery_update: "update_recovery",
  cash_opening: "save_cash_opening",
  cash_lender: "save_cash_lender",
  person_cash: "save_person_cash",
  cash_movement_delete: "delete_cash_movement",
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
    m.includes("unique constraint") ||
    m.includes("already cancelled") ||
    m.includes("already posted against") ||
    m.includes("does not sell past stock") ||
    m.includes("must pay") ||
    m.includes("select a customer") ||
    m.includes("no amount due") ||
    m.includes("only owes") ||
    m.includes("more than that invoice") ||
    m.includes("not on that sale") ||
    m.includes("belongs to a customer recovery") ||
    m.includes("more than the amount due") ||
    m.includes("does not match") ||
    m.includes("was just saved") ||
    m.includes("was not saved again") ||
    m.includes("this sale was just saved") ||
    m.includes("more than owed") ||
    m.includes("that much cash") ||
    m.includes("main company") ||
    m.includes("enter the person") ||
    m.includes("enter an amount") ||
    m.includes("choose another company") ||
    m.includes("both companies together")
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
  /** Optional note when main-hub mirror was skipped offline */
  hubNote?: string;
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
const submitInFlight = new Map<string, Promise<OfflineSubmitResult>>();

function submitFingerprint(params: OfflineSubmitParams) {
  return JSON.stringify({
    mutationType: params.mutationType,
    companyId: params.companyId,
    payload: params.payload,
    stockChanges: params.stockChanges ?? null,
    forceOffline: Boolean(params.forceOffline),
    localDocNo: params.localDocNo ?? null,
  });
}

/** Identical saves already running share one result, so a double-click cannot post twice. */
export function offlineAwareSubmit(
  params: OfflineSubmitParams,
): Promise<OfflineSubmitResult> {
  let key = "";
  try {
    key = submitFingerprint(params);
  } catch {
    return runOfflineAwareSubmit(params);
  }
  const existing = submitInFlight.get(key);
  if (existing) return existing;
  const promise = runOfflineAwareSubmit(params).finally(() => {
    if (submitInFlight.get(key) === promise) submitInFlight.delete(key);
  });
  submitInFlight.set(key, promise);
  return promise;
}

async function finalizeOnlineSubmit(
  params: OfflineSubmitParams,
  serverId: string,
): Promise<string | undefined> {
  const {
    mutationType,
    payload,
    companyId,
    stockChanges,
    cacheStore,
    cacheRecord,
  } = params;

  let hubNote: string | undefined;
  if (hasLocalSqlite()) {
    await persistMutationToSqlite({
      mutationType,
      payload,
      companyId,
      documentId: serverId,
      syncStatus: "synced",
      stockChanges,
      enqueueOutbox: false,
    }).catch((err) =>
      console.warn("[offlineAwareSubmit] SQLite mirror failed:", err),
    );
    hubNote = await runOfflineHubSideEffects({
      mutationType,
      companyId,
      documentId: serverId,
      payload,
      stockChanges,
    });
  }

  const cacheTarget = resolveCacheStore(mutationType, cacheStore);
  const storesToRefresh = new Set<CacheStoreName>();
  if (cacheTarget) storesToRefresh.add(cacheTarget);
  if (stockChanges?.length) storesToRefresh.add("stock_balances");
  if (storesToRefresh.size > 0) {
    try {
      const { refreshStoreCache } = await import("@/lib/offline/cache-manager");
      await Promise.all(
        [...storesToRefresh].map((store) =>
          refreshStoreCache(store, companyId),
        ),
      );
    } catch (err) {
      console.warn("[offlineAwareSubmit] cache refresh failed:", err);
      if (cacheTarget) {
        try {
          await putCachedRow(
            cacheTarget,
            companyId,
            normalizeCachedMutationRow(
              mutationType,
              cacheRecord || payload,
              serverId,
              companyId,
            ),
            "synced",
          );
        } catch {
          /* list will catch up on next full sync */
        }
      }
    }
  }

  return hubNote;
}

async function runOfflineAwareSubmit(
  params: OfflineSubmitParams,
): Promise<OfflineSubmitResult> {
  const {
    mutationType,
    companyId,
    forceOffline,
    localDocNo,
    stockChanges,
    cacheStore,
    cacheRecord,
  } = params;
  let { payload } = params;

  if (
    mutationType === "sale_invoice" &&
    !payload.client_request_id
  ) {
    const { createSaleClientRequestId } = await import(
      "@/lib/trading/sale-invoice-submit"
    );
    payload = { ...payload, client_request_id: createSaleClientRequestId() };
  }

  const submitParams: OfflineSubmitParams = { ...params, payload };

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

      const hubNote = await finalizeOnlineSubmit(submitParams, result.id);
      const { bumpListStatsRevision } = await import("@/lib/list-stats-revision");
      bumpListStatsRevision();

      return {
        id: result.id,
        source: "server",
        message: formatSubmitMessage(mutationType, hubNote),
        hubNote,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Real validation from the server must surface to the user — not hide in the offline queue.
      if (isBusinessRuleError(message) && !isNetworkishError(err)) {
        throw err instanceof Error ? err : new Error(message);
      }

      if (mutationType === "sale_invoice") {
        const requestId = payload.client_request_id;
        if (typeof requestId === "string" && requestId) {
          const { findSaleInvoiceIdByClientRequest } = await import(
            "@/lib/trading/sale-invoice-submit"
          );
          const existingId = await findSaleInvoiceIdByClientRequest(
            companyId,
            requestId,
          );
          if (existingId) {
            const hubNote = await finalizeOnlineSubmit(submitParams, existingId);
            const { bumpListStatsRevision } = await import(
              "@/lib/list-stats-revision"
            );
            bumpListStatsRevision();
            return {
              id: existingId,
              source: "server",
              message:
                "Sale invoice was already saved on the server. Opened that bill.",
              hubNote,
            };
          }
        }
      }

      console.warn(
        `[offlineAwareSubmit] Online ${mutationType} failed, queueing offline:`,
        err,
      );
    }
  }

  // ── Queue offline ───────────────────────────────────────────────
  if (mutationType === "sale_invoice" && payload.client_request_id) {
    const requestId = String(payload.client_request_id);
    const pending = await listPendingMutations(companyId);
    const existing = pending.find(
      (m) =>
        m.type === "sale_invoice" &&
        String(m.payload?.client_request_id || "") === requestId,
    );
    if (existing) {
      const existingId = String(existing.payload?.id || existing.id);
      return {
        id: existingId,
        source: "offline",
        message:
          "This sale is already saved on this device and will sync when the connection is stable.",
      };
    }
  }
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
        ...normalizeCachedMutationRow(
          mutationType,
          (cacheRecord || payload) as Record<string, unknown>,
          documentId,
          companyId,
          localId,
        ),
        party_name:
          (payload.party_name as string) ||
          (cacheRecord?.party_name as string) ||
          null,
        party_code:
          (payload.party_code as string) ||
          (cacheRecord?.party_code as string) ||
          null,
        parties: payload.parties || cacheRecord?.parties || null,
      },
      "pending",
    );
  }

  const hubNote = await runOfflineHubSideEffects({
    mutationType,
    companyId,
    documentId,
    payload: { ...payload, id: documentId, invoice_no: localId, doc_no: localId },
    stockChanges,
  });

  return {
    id: documentId || mutation.id,
    source: "offline",
    message: formatSubmitMessage(mutationType, hubNote),
    hubNote,
  };
}

/** Vendor link is stored with the company and applied through the supplier RPC on sync. */
export async function applyWarehouseSupplierLink(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
  warehouseId: string,
) {
  if (!warehouseId || !("default_supplier_id" in payload)) return;
  const raw = payload.default_supplier_id;
  const supplierId = raw ? String(raw) : null;
  const { error } = await supabase.rpc("set_warehouse_supplier", {
    p_warehouse_id: warehouseId,
    p_supplier_id: supplierId,
  });
  if (error) throw new Error(error.message);
}

function formatSubmitMessage(mutationType: OfflineMutationType, hubNote?: string) {
  const base = getSuccessMessage(mutationType);
  if (!hubNote) return base;
  return `${base} ${hubNote}`;
}

async function runOfflineHubSideEffects(opts: {
  mutationType: OfflineMutationType;
  companyId: string;
  documentId: string;
  payload: Record<string, unknown>;
  stockChanges?: OfflineSubmitParams["stockChanges"];
}): Promise<string | undefined> {
  const hubTypes = new Set([
    "product_create",
    "product_update",
    "party_create",
    "party_update",
    "purchase_invoice",
  ]);
  if (!hubTypes.has(opts.mutationType)) return undefined;
  if (!hasLocalSqlite()) return undefined;
  try {
    const { applyOfflineHubSideEffects } = await import(
      "@/lib/offline/offline-hub"
    );
    const { note } = await applyOfflineHubSideEffects(opts);
    return note;
  } catch (err) {
    console.warn("[offlineAwareSubmit] hub side effects failed:", err);
    return "Main hub will update when you reconnect.";
  }
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
    recovery_batch: "vouchers",
    cash_receipt: "vouchers",
    cash_payment: "vouchers",
    journal_voucher: "vouchers",
    expense: "expenses",
    stock_transfer: "stock_transfers",
    gate_pass: "gate_passes",
    gate_pass_update: "gate_passes",
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

const VOUCHER_TYPE_BY_MUTATION: Partial<Record<OfflineMutationType, string>> = {
  cash_receipt: "CR",
  cash_receipt_update: "CR",
  cash_payment: "CP",
  cash_payment_update: "CP",
  journal_voucher: "JV",
  journal_voucher_update: "JV",
  recovery: "CR",
  recovery_batch: "CR",
  recovery_update: "CR",
};

/** Keep voucher list filters working for offline/online cache rows. */
function normalizeCachedMutationRow(
  mutationType: OfflineMutationType,
  row: Record<string, unknown>,
  id: string,
  companyId: string,
  localId?: string,
) {
  const voucherType = VOUCHER_TYPE_BY_MUTATION[mutationType];
  const lines = Array.isArray(row.voucher_lines)
    ? row.voucher_lines
    : Array.isArray(row.lines)
      ? row.lines
      : undefined;
  return {
    ...row,
    id,
    company_id: companyId,
    status: row.status || "posted",
    ...(localId
      ? {
          invoice_no: localId,
          doc_no: localId,
          voucher_no: row.voucher_no || localId,
          _localId: localId,
        }
      : {}),
    ...(voucherType
      ? {
          voucher_type: row.voucher_type || voucherType,
          entity_type: row.entity_type || mutationType,
          voucher_date: row.voucher_date || row.doc_date || null,
          total_amount:
            row.total_amount ??
            row.amount ??
            row.grand_total ??
            0,
          ...(lines ? { voucher_lines: lines, lines } : {}),
        }
      : {}),
  };
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
    opts.mutationType === "sale_invoice_update" ||
    opts.mutationType === "purchase_invoice" ||
    opts.mutationType === "purchase_invoice_update"
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
      opts.mutationType === "sale_invoice" ||
      opts.mutationType === "sale_invoice_update"
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
  const { applyOfflineSharedStockDelta } = await import(
    "@/lib/offline/offline-hub"
  );

  // Hub-linked spoke SKUs update main-company stock; local-only SKUs stay here.
  const localChanges: typeof changes = [];
  for (const change of changes) {
    const res = await applyOfflineSharedStockDelta({
      companyId,
      productId: change.productId,
      warehouseId: change.warehouseId,
      delta: change.delta,
    });
    if (!res.redirected) {
      localChanges.push(change);
    }
  }

  if (!localChanges.length) return;

  const listed = await localListMaster("stock_balances", companyId, 20000);
  const rows = listed.rows || [];
  const byKey = new Map<string, Record<string, unknown>>(
    rows.map((r) => [`${r.product_id}:${r.warehouse_id}`, r]),
  );

  const upserts: Record<string, unknown>[] = [];
  for (const change of localChanges) {
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
    await applyWarehouseSupplierLink(supabase, payload, data.id);
    return { id: data.id };
  }

  if (mutationType === "warehouse_update") {
    const id = payload.id as string;
    const rest = { ...payload };
    delete rest.id;
    const { error } = await supabase.from("warehouses").update(rest).eq("id", id);
    if (error) throw new Error(error.message);
    await applyWarehouseSupplierLink(supabase, payload, id);
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
    recovery_batch: "Recovery posted successfully.",
    sale_invoice: "Sale invoice created.",
    sale_invoice_update: "Sale invoice updated.",
    purchase_invoice_update: "Purchase invoice updated.",
    sale_return_update: "Sale return updated.",
    purchase_return_update: "Purchase return updated.",
    cash_receipt_update: "Cash receipt updated.",
    cash_payment_update: "Cash payment updated.",
    journal_voucher_update: "Journal voucher updated.",
    recovery_update: "Recovery updated.",
    purchase_invoice: "Purchase invoice created.",
    sale_return: "Sale return created.",
    purchase_return: "Purchase return created.",
    cash_receipt: "Cash receipt posted.",
    cash_payment: "Cash payment posted.",
    journal_voucher: "Journal voucher posted.",
    stock_transfer: "Stock transfer posted.",
    gate_pass: "Gate pass created.",
    gate_pass_update: "Gate pass updated.",
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
  sale_invoice: { prefix: "SI-", pad: 4, store: "sale_invoices" },
  purchase_invoice: { prefix: "PI-", pad: 0, store: "purchase_invoices" },
  sale_return: { prefix: "SR-", pad: 0, store: "sale_returns" },
  purchase_return: { prefix: "PR-", pad: 0, store: "purchase_returns" },
  stock_transfer: { prefix: "ST-", pad: 0, store: "stock_transfers" },
  load_sheet: { prefix: "LD-", pad: 0, store: "load_sheets" },
  gate_pass: { prefix: "GP-", pad: 0, store: "gate_passes" },
  cash_receipt: { prefix: "CR-", pad: 0, store: "vouchers" },
  recovery: { prefix: "CR-", pad: 0, store: "vouchers" },
  recovery_batch: { prefix: "CR-", pad: 0, store: "vouchers" },
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
  opts?: { reserve?: boolean },
): Promise<string> {
  const cfg = SERIES_CONFIG[mutationType] || {
    prefix: "DOC-",
    pad: 4,
    store: "sale_invoices" as CacheStoreName,
  };
  const { prefix, pad, store } = cfg;

  let maxFound = 0;
  let padWidth = pad;

  // 1. Same counter the server uses (walk-in and other customers share it).
  const storageKey = `doc_seq_${companyId}_${prefix}`;
  const padKey = `doc_pad_${companyId}_${prefix}`;
  if (typeof window !== "undefined" && window.localStorage) {
    const stored = parseInt(window.localStorage.getItem(storageKey) || "0", 10);
    if (Number.isFinite(stored) && stored > maxFound) {
      maxFound = stored;
    }
    const storedPad = parseInt(window.localStorage.getItem(padKey) || "", 10);
    if (Number.isFinite(storedPad) && storedPad > 0) padWidth = storedPad;
  }

  try {
    const { isAppOnline } = await import("@/lib/offline/local-auth");
    if (await isAppOnline()) {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data } = await supabase.rpc("peek_document_series", {
        p_company_id: companyId,
        p_series_type: mutationType,
      });
      const series = data as {
        prefix?: string;
        next_number?: number;
        padding?: number;
      } | null;
      const nextNumber = Number(series?.next_number || 0);
      if (Number.isFinite(nextNumber) && nextNumber - 1 > maxFound) {
        maxFound = nextNumber - 1;
      }
      const serverPad = Number(series?.padding || 0);
      if (Number.isFinite(serverPad) && serverPad > 0) padWidth = serverPad;
    }
  } catch (e) {
    console.warn("[allocateSequentialDocNo] series peek failed:", e);
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
  if (opts?.reserve !== false && typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(storageKey, String(nextNum));
      window.localStorage.setItem(padKey, String(padWidth));
    } catch {}
  }

  return `${prefix}${padWidth > 0 ? String(nextNum).padStart(padWidth, "0") : nextNum}`;
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
  const companyIds = new Set<string>([companyId]);
  try {
    const { getCachedHubContext } = await import("@/lib/offline/cache-manager");
    const ctx = await getCachedHubContext();
    if (ctx?.mainCompanyId) companyIds.add(ctx.mainCompanyId);
    if (ctx?.spokeCompanyId) companyIds.add(ctx.spokeCompanyId);
  } catch {
    // Local numbering still uses the companies already on this machine.
  }
  for (const id of companyIds) {
    if (hasLocalSqlite()) {
      try {
        const res = await localListMaster("parties", id, 5000);
        for (const p of res.rows || []) {
          const code = String(p.code || p.party_code || "").trim();
          if (/^\d+$/.test(code)) {
            const n = parseInt(code, 10);
            if (n > maxCode) maxCode = n;
          }
        }
      } catch {
        // This company's local list is optional.
      }
    }
    try {
      const cached = await getCachedRows("parties", id);
      for (const p of cached) {
        const code = String(p.party_code || p.code || "").trim();
        if (/^\d+$/.test(code)) {
          const n = parseInt(code, 10);
          if (n > maxCode) maxCode = n;
        }
      }
    } catch {
      // IndexedDB is optional.
    }
  }
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


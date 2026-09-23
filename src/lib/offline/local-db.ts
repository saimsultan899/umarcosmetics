import { openDB, type DBSchema, type IDBPDatabase } from "idb";

// ── Sync status for every cached row ────────────────────────────────
export type SyncStatus = "synced" | "pending" | "syncing" | "failed" | "conflict";

// ── Mutation types (all write operations the app supports) ──────────
export type OfflineMutationType =
  | "recovery"
  | "sale_invoice"
  | "purchase_invoice"
  | "sale_return"
  | "purchase_return"
  | "cash_receipt"
  | "cash_payment"
  | "journal_voucher"
  | "stock_transfer"
  | "gate_pass"
  | "load_sheet"
  | "expense"
  | "party_create"
  | "party_update"
  | "product_create"
  | "product_update"
  | "warehouse_create"
  | "warehouse_update"
  | "salesman_create"
  | "salesman_update"
  | "expiry_receipt"
  | "expiry_claim"
  | "expiry_settle"
  | "salesman_invite";

// ── Mutation record (queued write) ──────────────────────────────────
export type OfflineMutation = {
  id: string;
  companyId: string;
  type: OfflineMutationType;
  payload: Record<string, unknown>;
  createdAt: string;
  status: "pending" | "syncing" | "failed";
  error?: string;
  attempts: number;
  /** Temporary local ID assigned to the created record (e.g. "LOCAL-SI-001") */
  localId?: string;
  /** Server-assigned ID after successful sync */
  serverId?: string;
};

// ── Cached row wrappers ─────────────────────────────────────────────
type CachedRow<T = Record<string, unknown>> = T & {
  _companyId: string;
  _syncStatus: SyncStatus;
  _locallyModified?: boolean;
  _cachedAt: string;
};

// ── Stock delta for offline stock tracking ──────────────────────────
export type StockDelta = {
  id: string;
  companyId: string;
  productId: string;
  warehouseId: string;
  delta: number;
  mutationId: string;
  createdAt: string;
};

// ── IndexedDB schema ────────────────────────────────────────────────
interface UmarOfflineDB extends DBSchema {
  // ── Mutation queue ──────────────────────────────────────────────
  mutations: {
    key: string;
    value: OfflineMutation;
    indexes: {
      "by-company-status": [string, string];
      "by-type": string;
    };
  };

  // ── Metadata (sync timestamps, session cache, etc.) ────────────
  meta: {
    key: string;
    value: { key: string; value: unknown };
  };

  // ── Master data caches ─────────────────────────────────────────
  parties: {
    key: string;
    value: CachedRow;
    indexes: { "by-company": string };
  };
  products: {
    key: string;
    value: CachedRow;
    indexes: { "by-company": string };
  };
  warehouses: {
    key: string;
    value: CachedRow;
    indexes: { "by-company": string };
  };
  stock_balances: {
    key: string;
    value: CachedRow;
    indexes: { "by-company": string; "by-product": string };
  };
  company_locations: {
    key: string;
    value: CachedRow;
    indexes: { "by-company": string };
  };
  salesmen: {
    key: string;
    value: CachedRow;
    indexes: { "by-company": string };
  };

  // ── Transaction document caches ────────────────────────────────
  sale_invoices: {
    key: string;
    value: CachedRow;
    indexes: { "by-company": string; "by-date": string };
  };
  purchase_invoices: {
    key: string;
    value: CachedRow;
    indexes: { "by-company": string; "by-date": string };
  };
  sale_returns: {
    key: string;
    value: CachedRow;
    indexes: { "by-company": string };
  };
  purchase_returns: {
    key: string;
    value: CachedRow;
    indexes: { "by-company": string };
  };
  vouchers: {
    key: string;
    value: CachedRow;
    indexes: { "by-company": string; "by-type": string };
  };
  expenses: {
    key: string;
    value: CachedRow;
    indexes: { "by-company": string };
  };
  stock_transfers: {
    key: string;
    value: CachedRow;
    indexes: { "by-company": string };
  };
  gate_passes: {
    key: string;
    value: CachedRow;
    indexes: { "by-company": string };
  };
  load_sheets: {
    key: string;
    value: CachedRow;
    indexes: { "by-company": string };
  };
  expiry_receipts: {
    key: string;
    value: CachedRow;
    indexes: { "by-company": string };
  };
  expiry_claims: {
    key: string;
    value: CachedRow;
    indexes: { "by-company": string };
  };

  // ── Stock deltas (offline stock tracking) ──────────────────────
  stock_deltas: {
    key: string;
    value: StockDelta;
    indexes: {
      "by-company": string;
      "by-product-warehouse": [string, string];
      "by-mutation": string;
    };
  };

  // ── Session cache (auth, profile, company) ─────────────────────
  session: {
    key: string;
    value: { key: string; value: unknown; updatedAt: string };
  };
}

// ── Singleton database connection ───────────────────────────────────

const DB_NAME = "umar-offline";
// Version-gated IndexedDB schema. Bump only when adding stores/indexes.
// Upgrade steps MUST be additive — never delete the `mutations` outbox or
// locally-modified cache rows. App-shell updates (service worker / Electron)
// must not bump this unless the new code needs a new store.
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<UmarOfflineDB>> | null = null;

export function getDb() {
  if (typeof window === "undefined") {
    throw new Error("Offline DB is browser-only");
  }
  if (!dbPromise) {
    dbPromise = openDB<UmarOfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // ── v1 stores (backward-compatible) ───────────────────────
        if (oldVersion < 1) {
          const mutations = db.createObjectStore("mutations", { keyPath: "id" });
          mutations.createIndex("by-company-status", ["companyId", "status"]);
          mutations.createIndex("by-type", "type");
          db.createObjectStore("meta", { keyPath: "key" });
        }

        // ── v2 stores (new offline-first layer) ───────────────────
        if (oldVersion < 2) {
          // Master data
          const parties = db.createObjectStore("parties", { keyPath: "id" });
          parties.createIndex("by-company", "_companyId");

          const products = db.createObjectStore("products", { keyPath: "id" });
          products.createIndex("by-company", "_companyId");

          const warehouses = db.createObjectStore("warehouses", { keyPath: "id" });
          warehouses.createIndex("by-company", "_companyId");

          const stockBal = db.createObjectStore("stock_balances", { keyPath: "id" });
          stockBal.createIndex("by-company", "_companyId");
          stockBal.createIndex("by-product", "product_id");

          const locations = db.createObjectStore("company_locations", { keyPath: "id" });
          locations.createIndex("by-company", "_companyId");

          const salesmen = db.createObjectStore("salesmen", { keyPath: "id" });
          salesmen.createIndex("by-company", "_companyId");

          // Transaction documents
          const saleInv = db.createObjectStore("sale_invoices", { keyPath: "id" });
          saleInv.createIndex("by-company", "_companyId");
          saleInv.createIndex("by-date", "invoice_date");

          const purchInv = db.createObjectStore("purchase_invoices", { keyPath: "id" });
          purchInv.createIndex("by-company", "_companyId");
          purchInv.createIndex("by-date", "invoice_date");

          const saleRet = db.createObjectStore("sale_returns", { keyPath: "id" });
          saleRet.createIndex("by-company", "_companyId");

          const purchRet = db.createObjectStore("purchase_returns", { keyPath: "id" });
          purchRet.createIndex("by-company", "_companyId");

          const vouchers = db.createObjectStore("vouchers", { keyPath: "id" });
          vouchers.createIndex("by-company", "_companyId");
          vouchers.createIndex("by-type", "voucher_type");

          const expenses = db.createObjectStore("expenses", { keyPath: "id" });
          expenses.createIndex("by-company", "_companyId");

          const stockTx = db.createObjectStore("stock_transfers", { keyPath: "id" });
          stockTx.createIndex("by-company", "_companyId");

          const gatePasses = db.createObjectStore("gate_passes", { keyPath: "id" });
          gatePasses.createIndex("by-company", "_companyId");

          const loadSheets = db.createObjectStore("load_sheets", { keyPath: "id" });
          loadSheets.createIndex("by-company", "_companyId");

          const expiryRec = db.createObjectStore("expiry_receipts", { keyPath: "id" });
          expiryRec.createIndex("by-company", "_companyId");

          const expiryCl = db.createObjectStore("expiry_claims", { keyPath: "id" });
          expiryCl.createIndex("by-company", "_companyId");

          // Stock deltas
          const deltas = db.createObjectStore("stock_deltas", { keyPath: "id" });
          deltas.createIndex("by-company", "companyId");
          deltas.createIndex("by-product-warehouse", ["productId", "warehouseId"]);
          deltas.createIndex("by-mutation", "mutationId");

          // Session cache
          db.createObjectStore("session", { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}

// ── Store names type helper ─────────────────────────────────────────

export type CacheStoreName =
  | "parties"
  | "products"
  | "warehouses"
  | "stock_balances"
  | "company_locations"
  | "salesmen"
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
  | "expiry_claims";

// ── Mutation queue helpers ──────────────────────────────────────────

export async function enqueueMutation(
  input: Omit<OfflineMutation, "id" | "createdAt" | "status" | "attempts">,
) {
  const db = await getDb();
  const row: OfflineMutation = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "pending",
    attempts: 0,
  };
  await db.put("mutations", row);
  return row;
}

export async function listPendingMutations(companyId: string) {
  const db = await getDb();
  const all = await db.getAll("mutations");
  return all
    .filter(
      (m) =>
        m.companyId === companyId &&
        (m.status === "pending" || m.status === "failed" || m.status === "syncing"),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function countPendingMutations(companyId: string) {
  const pending = await listPendingMutations(companyId);
  return pending.length;
}

export async function listAllPendingMutations() {
  const db = await getDb();
  const all = await db.getAll("mutations");
  return all
    .filter(
      (m) =>
        m.status === "pending" || m.status === "failed" || m.status === "syncing",
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function updateMutation(id: string, patch: Partial<OfflineMutation>) {
  const db = await getDb();
  const current = await db.get("mutations", id);
  if (!current) return;
  await db.put("mutations", { ...current, ...patch });
}

export async function removeMutation(id: string) {
  const db = await getDb();
  await db.delete("mutations", id);
}

// ── Cache read/write helpers ────────────────────────────────────────

export async function cacheRows(
  storeName: CacheStoreName,
  companyId: string,
  rows: Record<string, unknown>[],
  opts?: { clearExisting?: boolean },
) {
  const db = await getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);

  if (opts?.clearExisting) {
    // Clear existing rows for this company
    const index = store.index("by-company");
    let cursor = await index.openCursor(companyId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
  }

  for (const row of rows) {
    const cached = {
      ...row,
      _companyId: companyId,
      _syncStatus: "synced" as SyncStatus,
      _cachedAt: now,
    };
    await store.put(cached as CachedRow);
  }

  await tx.done;

  // Record cache timestamp
  await setCacheMeta(storeName, companyId, now);
}

export async function getCachedRows(
  storeName: CacheStoreName,
  companyId: string,
): Promise<CachedRow[]> {
  const db = await getDb();
  const tx = db.transaction(storeName, "readonly");
  const index = tx.objectStore(storeName).index("by-company");
  return index.getAll(companyId);
}

export async function getCachedRow(
  storeName: CacheStoreName,
  id: string,
): Promise<CachedRow | undefined> {
  const db = await getDb();
  return db.get(storeName, id);
}

export async function putCachedRow(
  storeName: CacheStoreName,
  companyId: string,
  row: Record<string, unknown>,
  syncStatus: SyncStatus = "pending",
) {
  const db = await getDb();
  const now = new Date().toISOString();
  const cached = {
    ...row,
    _companyId: companyId,
    _syncStatus: syncStatus,
    _locallyModified: syncStatus !== "synced",
    _cachedAt: now,
  };
  await db.put(storeName, cached as CachedRow);
}

export async function deleteCachedRow(
  storeName: CacheStoreName,
  id: string,
) {
  const db = await getDb();
  await db.delete(storeName, id);
}

// ── Cache metadata ──────────────────────────────────────────────────

async function setCacheMeta(storeName: string, companyId: string, timestamp: string) {
  const db = await getDb();
  await db.put("meta", {
    key: `cache:${storeName}:${companyId}`,
    value: timestamp,
  });
}

export async function getCacheAge(storeName: CacheStoreName, companyId: string): Promise<number | null> {
  const db = await getDb();
  const row = await db.get("meta", `cache:${storeName}:${companyId}`);
  if (!row?.value) return null;
  return Date.now() - new Date(row.value as string).getTime();
}

export async function getLastCacheTime(storeName: CacheStoreName, companyId: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.get("meta", `cache:${storeName}:${companyId}`);
  return (row?.value as string) || null;
}

// ── Sync metadata ───────────────────────────────────────────────────

export async function clearSyncedMeta(companyId: string) {
  const db = await getDb();
  await db.put("meta", {
    key: `last-sync:${companyId}`,
    value: new Date().toISOString(),
  });
}

export async function getLastSync(companyId: string) {
  const db = await getDb();
  const row = await db.get("meta", `last-sync:${companyId}`);
  return (row?.value as string) || null;
}

// ── Session cache (auth, profile, company) ──────────────────────────

export async function cacheSession(key: string, value: unknown) {
  const db = await getDb();
  await db.put("session", {
    key,
    value,
    updatedAt: new Date().toISOString(),
  });
}

export async function getCachedSession(key: string): Promise<unknown | null> {
  const db = await getDb();
  const row = await db.get("session", key);
  return row?.value ?? null;
}

// ── Stock deltas ────────────────────────────────────────────────────

export async function addStockDelta(delta: Omit<StockDelta, "id" | "createdAt">) {
  const db = await getDb();
  const row: StockDelta = {
    ...delta,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  await db.put("stock_deltas", row);
  return row;
}

export async function getStockDeltas(
  companyId: string,
): Promise<StockDelta[]> {
  const db = await getDb();
  const index = db.transaction("stock_deltas", "readonly").objectStore("stock_deltas").index("by-company");
  return index.getAll(companyId);
}

export async function getProductWarehouseStock(
  productId: string,
  warehouseId: string,
): Promise<number> {
  const db = await getDb();
  const index = db
    .transaction("stock_deltas", "readonly")
    .objectStore("stock_deltas")
    .index("by-product-warehouse");
  const deltas = await index.getAll([productId, warehouseId]);
  return deltas.reduce((sum, d) => sum + d.delta, 0);
}

export async function removeStockDeltasForMutation(mutationId: string) {
  const db = await getDb();
  const tx = db.transaction("stock_deltas", "readwrite");
  const index = tx.objectStore("stock_deltas").index("by-mutation");
  let cursor = await index.openCursor(mutationId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function clearStockDeltas(companyId: string) {
  const db = await getDb();
  const tx = db.transaction("stock_deltas", "readwrite");
  const index = tx.objectStore("stock_deltas").index("by-company");
  let cursor = await index.openCursor(companyId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

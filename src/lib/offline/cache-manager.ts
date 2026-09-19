import { createClient } from "@/lib/supabase/client";
import {
  cacheRows,
  cacheSession,
  getCacheAge,
  getCachedRows,
  getCachedSession,
  type CacheStoreName,
} from "@/lib/offline/local-db";

// ── Configuration ───────────────────────────────────────────────────

/** Maximum cache age before auto-refresh (1 hour). */
const CACHE_MAX_AGE_MS = 60 * 60 * 1000;

/** Master data stores that should be eagerly cached. */
const MASTER_STORES: CacheStoreName[] = [
  "parties",
  "products",
  "warehouses",
  "stock_balances",
  "company_locations",
  "salesmen",
];

/** Document stores warmed for full offline ERP + reports. */
const DOCUMENT_STORES: CacheStoreName[] = [
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

const ALL_SNAPSHOT_STORES: CacheStoreName[] = [
  ...MASTER_STORES,
  ...DOCUMENT_STORES,
];

export function getSnapshotStoreNames() {
  return ALL_SNAPSHOT_STORES;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Refresh all master data caches for a company.
 * Should be called:
 * 1. On first load when online
 * 2. After a successful sync
 * 3. When cache is stale (> CACHE_MAX_AGE_MS)
 */
export async function refreshAllCaches(companyId: string) {
  const results: Array<{ store: CacheStoreName; count: number; error?: string }> = [];

  for (const store of ALL_SNAPSHOT_STORES) {
    try {
      const count = await refreshStoreCache(store, companyId);
      results.push({ store, count });
    } catch (err) {
      results.push({
        store,
        count: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  try {
    const { cacheSession } = await import("@/lib/offline/local-db");
    await cacheSession(`snapshot-ready:${companyId}`, {
      at: new Date().toISOString(),
      stores: results.filter((r) => !r.error).map((r) => r.store),
    });
  } catch {
    /* ignore */
  }

  // Desktop: push IndexedDB snapshot into SQLite local ledger
  try {
    await bootstrapSqliteFromCaches(companyId);
  } catch (err) {
    console.warn("[cache-manager] SQLite bootstrap failed:", err);
  }

  return results;
}

/**
 * Copy current IndexedDB caches into Electron SQLite (hybrid local ledger).
 */
export async function bootstrapSqliteFromCaches(companyId: string) {
  const {
    hasLocalSqlite,
    localBootstrapCompany,
    CACHE_STORE_TO_ENTITY,
  } = await import("@/lib/offline/sqlite-client");
  if (!hasLocalSqlite()) return { ok: false, skipped: true };

  const snapshot: Record<string, unknown> = {};
  for (const store of MASTER_STORES) {
    snapshot[store] = await getCachedRows(store, companyId);
  }
  snapshot.sale_invoices = await getCachedRows("sale_invoices", companyId);
  snapshot.purchase_invoices = await getCachedRows("purchase_invoices", companyId);

  const localDocs: Record<string, unknown>[] = [];
  for (const [store, entityType] of Object.entries(CACHE_STORE_TO_ENTITY)) {
    const rows = await getCachedRows(store as CacheStoreName, companyId);
    for (const row of rows) {
      localDocs.push({
        ...row,
        id: row.id,
        company_id: companyId,
        entity_type: entityType,
        doc_no: row.invoice_no || row.doc_no || row.voucher_no || null,
        doc_date:
          row.invoice_date ||
          row.doc_date ||
          row.voucher_date ||
          row.expense_date ||
          null,
        party_id: row.party_id || null,
        amount: row.grand_total ?? row.amount ?? 0,
        status: row.status || "posted",
        payload: row,
      });
    }
  }
  // Vouchers are mixed types — store under entity_type from row or "voucher"
  const vouchers = await getCachedRows("vouchers", companyId);
  for (const row of vouchers) {
    localDocs.push({
      ...row,
      id: row.id,
      company_id: companyId,
      entity_type: String(row.voucher_type || row.type || "voucher"),
      doc_no: row.voucher_no || row.doc_no || null,
      doc_date: row.voucher_date || row.doc_date || null,
      party_id: row.party_id || null,
      amount: row.amount ?? row.grand_total ?? 0,
      status: row.status || "posted",
      payload: row,
    });
  }
  snapshot.local_documents = localDocs;

  return localBootstrapCompany(companyId, snapshot);
}

/**
 * True when a full snapshot was marked ready for this company.
 */
export async function isSnapshotReady(companyId: string): Promise<boolean> {
  const { getCachedSession } = await import("@/lib/offline/local-db");
  const row = await getCachedSession(`snapshot-ready:${companyId}`);
  return !!row;
}

/**
 * Refresh a single store's cache from Supabase.
 */
export async function refreshStoreCache(
  storeName: CacheStoreName,
  companyId: string,
): Promise<number> {
  const supabase = createClient();
  const config = STORE_FETCH_CONFIG[storeName];

  if (!config) {
    throw new Error(`No fetch config for store: ${storeName}`);
  }

  const { data, error } = await config.fetch(supabase, companyId);
  if (error) throw new Error(error.message);

  const rows = (data || []) as Record<string, unknown>[];
  await cacheRows(storeName, companyId, rows, { clearExisting: true });
  return rows.length;
}

/**
 * Check if any caches are stale and need refreshing.
 */
export async function checkCacheFreshness(companyId: string): Promise<{
  stale: CacheStoreName[];
  fresh: CacheStoreName[];
  missing: CacheStoreName[];
}> {
  const stale: CacheStoreName[] = [];
  const fresh: CacheStoreName[] = [];
  const missing: CacheStoreName[] = [];

  for (const store of MASTER_STORES) {
    const age = await getCacheAge(store, companyId);
    if (age === null) {
      missing.push(store);
    } else if (age > CACHE_MAX_AGE_MS) {
      stale.push(store);
    } else {
      fresh.push(store);
    }
  }

  return { stale, fresh, missing };
}

/**
 * Auto-refresh stale or missing caches. Call this when the app detects
 * that it's online. Non-blocking — swallows errors.
 */
export async function autoRefreshStaleCaches(companyId: string) {
  try {
    const { stale, missing } = await checkCacheFreshness(companyId);
    const needRefresh = [...missing, ...stale];

    for (const store of DOCUMENT_STORES) {
      const age = await getCacheAge(store, companyId);
      if (age === null || age > CACHE_MAX_AGE_MS) {
        needRefresh.push(store);
      }
    }

    const unique = [...new Set(needRefresh)];
    if (unique.length === 0) {
      // Still mark ready if master caches exist
      const age = await getCacheAge("parties", companyId);
      if (age !== null) {
        const { cacheSession } = await import("@/lib/offline/local-db");
        await cacheSession(`snapshot-ready:${companyId}`, {
          at: new Date().toISOString(),
        });
      }
      return;
    }

    for (const store of unique) {
      try {
        await refreshStoreCache(store, companyId);
      } catch {
        // Non-critical — will retry later
      }
    }

    const { cacheSession } = await import("@/lib/offline/local-db");
    await cacheSession(`snapshot-ready:${companyId}`, {
      at: new Date().toISOString(),
      stores: unique,
    });
  } catch {
    // Swallow top-level error
  }
}

/**
 * Get data from cache or fetch from server.
 * - Online: fetch from server, update cache in background
 * - Offline: read from cache
 */
export async function getDataWithFallback<T = Record<string, unknown>>(
  storeName: CacheStoreName,
  companyId: string,
  opts?: {
    /** If true, always try server first even if cache is fresh */
    forceServer?: boolean;
    /** Custom filter function applied to cached rows */
    filter?: (row: T) => boolean;
  },
): Promise<{
  data: T[];
  source: "server" | "cache";
  cacheAgeMs: number | null;
}> {
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;
  const cacheAge = await getCacheAge(storeName, companyId);

  // If online and cache is stale (or forced), fetch from server
  if (online && (opts?.forceServer || cacheAge === null || cacheAge > CACHE_MAX_AGE_MS)) {
    try {
      await Promise.race([
        refreshStoreCache(storeName, companyId),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("cache refresh timeout")), 10000),
        ),
      ]);
      const cached = await getCachedRows(storeName, companyId);
      const rows = cached as unknown as T[];
      // Keep SQLite warm after cloud refresh
      void bootstrapSqliteFromCaches(companyId).catch(() => undefined);
      return {
        data: opts?.filter ? rows.filter(opts.filter) : rows,
        source: "server",
        cacheAgeMs: 0,
      };
    } catch {
      // Server fetch failed — fall through to cache / SQLite
    }
  }

  // Desktop offline: merge SQLite ledger with IndexedDB cache so all records are always present
  const sqliteRows = await readStoreFromSqlite<T>(storeName, companyId);
  const cached = (await getCachedRows(storeName, companyId)) as unknown as T[];

  let rows: T[] = [];
  if (sqliteRows && sqliteRows.length > 0 && cached && cached.length > 0) {
    const seen = new Set(
      sqliteRows.map((r) => {
        const anyR = r as Record<string, unknown>;
        return String(anyR.id || anyR._localId || anyR.invoice_no || anyR.doc_no || "");
      }),
    );
    rows = [...sqliteRows];
    for (const r of cached) {
      const anyR = r as Record<string, unknown>;
      const k = String(anyR.id || anyR._localId || anyR.invoice_no || anyR.doc_no || "");
      if (k && !seen.has(k)) {
        rows.push(r);
        seen.add(k);
      }
    }
  } else if (sqliteRows && sqliteRows.length > 0) {
    rows = sqliteRows;
  } else {
    rows = cached || [];
  }

  return {
    data: opts?.filter ? rows.filter(opts.filter) : rows,
    source: "cache",
    cacheAgeMs: cacheAge,
  };
}

async function readStoreFromSqlite<T>(
  storeName: CacheStoreName,
  companyId: string,
): Promise<T[] | null> {
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
    if (!hasLocalSqlite()) return null;

    const master = MASTER_CACHE_TO_SQLITE[storeName];
    if (master) {
      const res = await localListMaster(master, companyId);
      return (res.rows || []) as T[];
    }

    if (storeName === "sale_invoices" || storeName === "purchase_invoices") {
      const res = await localListDocuments(storeName, companyId);
      return (res.rows || []) as T[];
    }

    const entity = CACHE_STORE_TO_ENTITY[storeName];
    if (entity) {
      const res = await localListByEntity(companyId, entity);
      return (res.rows || []) as T[];
    }

    if (storeName === "vouchers") {
      // Single IPC call for all voucher entity types (was 5 sequential calls)
      const res = await localListDocumentsByTypes(companyId, [
        "recovery",
        "cash_receipt",
        "cash_payment",
        "journal_voucher",
        "voucher",
      ]);
      return (res.rows || []) as T[];
    }
  } catch (err) {
    console.warn("[getDataWithFallback] SQLite read failed:", err);
  }
  return null;
}

// ── Session cache helpers ───────────────────────────────────────────

/**
 * Cache the authenticated user's profile and company data for offline shell rendering.
 */
export async function cacheSessionData(data: {
  userId: string;
  profile: Record<string, unknown>;
  company: Record<string, unknown> | null;
  memberships: Record<string, unknown>[];
}) {
  await cacheSession("user_id", data.userId);
  await cacheSession("profile", data.profile);
  await cacheSession("company", data.company);
  await cacheSession("memberships", data.memberships);
}

/**
 * Retrieve cached session data for offline rendering.
 */
export async function getCachedSessionData() {
  const [userId, profile, company, memberships] = await Promise.all([
    getCachedSession("user_id"),
    getCachedSession("profile"),
    getCachedSession("company"),
    getCachedSession("memberships"),
  ]);

  if (!userId || !profile) return null;

  return {
    userId: userId as string,
    profile: profile as Record<string, unknown>,
    company: company as Record<string, unknown> | null,
    memberships: (memberships || []) as Record<string, unknown>[],
  };
}

// ── Fetch configurations per store ──────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
type FetchConfig = {
  fetch: (
    supabase: ReturnType<typeof createClient>,
    companyId: string,
  ) => PromiseLike<{ data: any; error: any }>;
};

const STORE_FETCH_CONFIG: Record<string, FetchConfig> = {
  parties: {
    fetch: (s, cid) =>
      s.from("parties").select("*").eq("company_id", cid).eq("is_active", true).order("name_en").limit(10000),
  },
  products: {
    fetch: (s, cid) =>
      s.from("products").select("*").eq("company_id", cid).eq("is_active", true).order("code").limit(10000),
  },
  warehouses: {
    fetch: (s, cid) =>
      s.from("warehouses").select("*").eq("company_id", cid).eq("is_active", true).order("name"),
  },
  stock_balances: {
    fetch: (s, cid) =>
      s.from("stock_balances").select("*").eq("company_id", cid).limit(20000),
  },
  company_locations: {
    fetch: (s, cid) =>
      s.from("company_locations").select("*").eq("company_id", cid),
  },
  salesmen: {
    fetch: (s, cid) =>
      s.from("salesmen_roster")
        .select("id, user_id, company_id, full_name, phone, routes, cities, is_active")
        .eq("company_id", cid)
        .eq("is_active", true),
  },
  sale_invoices: {
    fetch: (s, cid) =>
      s.from("sale_invoices")
        .select("*, parties(name_en, party_code, route, head, city, address), warehouses(name), sale_invoice_items(*)")
        .eq("company_id", cid)
        .order("invoice_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(2000),
  },
  purchase_invoices: {
    fetch: (s, cid) =>
      s.from("purchase_invoices")
        .select("*, parties(name_en, party_code, route, head, city, address), warehouses(name), purchase_invoice_items(*)")
        .eq("company_id", cid)
        .order("invoice_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(2000),
  },
  sale_returns: {
    fetch: (s, cid) =>
      s.from("sale_returns")
        .select("*, parties(name_en, party_code, route, head, city, address), warehouses(name), sale_return_items(*)")
        .eq("company_id", cid)
        .order("return_date", { ascending: false })
        .limit(1000),
  },
  purchase_returns: {
    fetch: (s, cid) =>
      s.from("purchase_returns")
        .select("*, parties(name_en, party_code, route, head, city, address), warehouses(name), purchase_return_items(*)")
        .eq("company_id", cid)
        .order("return_date", { ascending: false })
        .limit(1000),
  },
  vouchers: {
    fetch: (s, cid) =>
      s.from("vouchers")
        .select("*, voucher_lines(*)")
        .eq("company_id", cid)
        .order("voucher_date", { ascending: false })
        .limit(2000),
  },
  expenses: {
    fetch: (s, cid) =>
      s.from("expenses")
        .select("*, salesman:salesmen!expenses_salesman_id_fkey(full_name)")
        .eq("company_id", cid)
        .order("expense_date", { ascending: false })
        .limit(1000),
  },
  stock_transfers: {
    fetch: (s, cid) =>
      s.from("stock_transfers")
        .select("*, stock_transfer_items(*), from_warehouse:warehouses!stock_transfers_from_warehouse_id_fkey(name), to_warehouse:warehouses!stock_transfers_to_warehouse_id_fkey(name)")
        .eq("company_id", cid)
        .order("transfer_date", { ascending: false })
        .limit(1000),
  },
  gate_passes: {
    fetch: (s, cid) =>
      s.from("gate_passes")
        .select("*, gate_pass_items(*), parties(name_en, party_code), warehouses(name)")
        .eq("company_id", cid)
        .order("pass_date", { ascending: false })
        .limit(1000),
  },
  load_sheets: {
    fetch: (s, cid) =>
      s.from("load_sheets")
        .select("*, load_sheet_items(*), warehouses(name)")
        .eq("company_id", cid)
        .order("created_at", { ascending: false })
        .limit(1000),
  },
  expiry_receipts: {
    fetch: (s, cid) =>
      s.from("expiry_receipts")
        .select("*, parties(name_en, party_code, route, head, city, address), expiry_receipt_items(*)")
        .eq("company_id", cid)
        .order("receipt_date", { ascending: false })
        .limit(1000),
  },
  expiry_claims: {
    fetch: (s, cid) =>
      s.from("expiry_claims")
        .select("*, parties(name_en, party_code, route, head, city, address), warehouses(name), expiry_claim_items(*)")
        .eq("company_id", cid)
        .order("claim_date", { ascending: false })
        .limit(1000),
  },
};

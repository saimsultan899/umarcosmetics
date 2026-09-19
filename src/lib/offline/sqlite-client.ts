/**
 * Renderer helpers for the Electron SQLite ledger.
 * No-ops / null when not running inside the desktop shell.
 */

export type LocalMasterTable =
  | "parties"
  | "products"
  | "warehouses"
  | "stock_balances"
  | "salesmen"
  | "company_locations";

export type LocalDocumentTable = "sale_invoices" | "purchase_invoices";

export type LocalDbResult<T = Record<string, unknown>> = {
  ok: boolean;
  error?: string;
} & T;

type LocalDesktopDb = {
  isDesktop?: boolean;
  dbStatus?: () => Promise<LocalDbResult>;
  dbUpsertMaster?: (
    table: LocalMasterTable,
    row: Record<string, unknown>,
  ) => Promise<LocalDbResult<{ id?: string }>>;
  dbBulkUpsertMaster?: (
    table: LocalMasterTable,
    rows: Record<string, unknown>[],
  ) => Promise<LocalDbResult<{ count?: number }>>;
  dbListMaster?: (
    table: LocalMasterTable,
    companyId: string,
    limit?: number,
  ) => Promise<LocalDbResult<{ rows?: Record<string, unknown>[] }>>;
  dbSaveSaleInvoice?: (
    input: Record<string, unknown>,
  ) => Promise<LocalDbResult<{ id?: string; sync_status?: string }>>;
  dbSavePurchaseInvoice?: (
    input: Record<string, unknown>,
  ) => Promise<LocalDbResult<{ id?: string; sync_status?: string }>>;
  dbSaveLocalDocument?: (
    input: Record<string, unknown>,
  ) => Promise<LocalDbResult<{ id?: string; sync_status?: string }>>;
  dbListDocuments?: (
    table: LocalDocumentTable,
    companyId: string,
    limit?: number,
  ) => Promise<LocalDbResult<{ rows?: Record<string, unknown>[] }>>;
  dbGetDocument?: (
    table: LocalDocumentTable,
    id: string,
  ) => Promise<LocalDbResult<{ row?: Record<string, unknown> | null }>>;
  dbListLocalDocuments?: (
    companyId: string,
    entityType?: string | null,
    limit?: number,
  ) => Promise<LocalDbResult<{ rows?: Record<string, unknown>[] }>>;
  dbGetLocalDocument?: (
    id: string,
  ) => Promise<LocalDbResult<{ row?: Record<string, unknown> | null }>>;
  dbListOutbox?: (
    companyId: string,
    status?: string,
    limit?: number,
  ) => Promise<LocalDbResult<{ rows?: Record<string, unknown>[] }>>;
  dbMarkOutbox?: (
    id: string,
    patch: Record<string, unknown>,
  ) => Promise<LocalDbResult<{ id?: string }>>;
  dbMarkEntitySynced?: (
    entityType: string,
    entityId: string,
    syncStatus?: string,
  ) => Promise<LocalDbResult<{ id?: string }>>;
  dbBootstrapCompany?: (
    companyId: string,
    snapshot: Record<string, unknown>,
  ) => Promise<LocalDbResult>;

  // ── Batched / performance IPC ──────────────────────────────────
  dbListLocalDocumentsByTypes?: (
    companyId: string,
    entityTypes: string[],
    limit?: number,
  ) => Promise<LocalDbResult<{ rows?: Record<string, unknown>[] }>>;
  dbBulkUpsertStockBalances?: (
    companyId: string,
    changes: Record<string, unknown>[],
  ) => Promise<LocalDbResult<{ count?: number }>>;
  dbBatchQuery?: (
    specs: Array<{
      store: string;
      companyId: string;
      entityType?: string;
      entityTypes?: string[];
      limit?: number;
    }>,
  ) => Promise<LocalDbResult<{ results?: Record<string, unknown>[][] }>>;
  dbMigrateLegacyDocNos?: (
    companyId: string,
  ) => Promise<LocalDbResult<{ count?: number }>>;
};

function desktop(): LocalDesktopDb | null {
  if (typeof window === "undefined") return null;
  const api = (window as Window & { umarDesktop?: LocalDesktopDb }).umarDesktop;
  if (!api?.isDesktop) return null;
  return api;
}

export function hasLocalSqlite() {
  return !!desktop()?.dbStatus;
}

export async function localDbStatus() {
  const api = desktop();
  if (!api?.dbStatus) return { ok: false, error: "Local DB not available" };
  return api.dbStatus();
}

export async function localUpsertMaster(
  table: LocalMasterTable,
  row: Record<string, unknown>,
) {
  const api = desktop();
  if (!api?.dbUpsertMaster) return { ok: false, error: "Local DB not available" };
  return api.dbUpsertMaster(table, row);
}

export async function localBulkUpsertMaster(
  table: LocalMasterTable,
  rows: Record<string, unknown>[],
) {
  const api = desktop();
  if (!api?.dbBulkUpsertMaster) {
    return { ok: false, error: "Local DB not available", count: 0 };
  }
  return api.dbBulkUpsertMaster(table, rows);
}

export async function localListMaster(
  table: LocalMasterTable,
  companyId: string,
  limit?: number,
) {
  const api = desktop();
  if (!api?.dbListMaster) return { ok: false, error: "Local DB not available", rows: [] };
  return api.dbListMaster(table, companyId, limit);
}

export async function localSaveSaleInvoice(input: Record<string, unknown>) {
  const api = desktop();
  if (!api?.dbSaveSaleInvoice) {
    return { ok: false, error: "Local DB not available" };
  }
  return api.dbSaveSaleInvoice(input);
}

export async function localSavePurchaseInvoice(input: Record<string, unknown>) {
  const api = desktop();
  if (!api?.dbSavePurchaseInvoice) {
    return { ok: false, error: "Local DB not available" };
  }
  return api.dbSavePurchaseInvoice(input);
}

export async function localSaveDocument(input: Record<string, unknown>) {
  const api = desktop();
  if (!api?.dbSaveLocalDocument) {
    return { ok: false, error: "Local DB not available" };
  }
  return api.dbSaveLocalDocument(input);
}

export async function localListDocuments(
  table: LocalDocumentTable,
  companyId: string,
  limit?: number,
) {
  const api = desktop();
  if (!api?.dbListDocuments) {
    return { ok: false, error: "Local DB not available", rows: [] };
  }
  return api.dbListDocuments(table, companyId, limit);
}

export async function localGetDocument(table: LocalDocumentTable, id: string) {
  const api = desktop();
  if (!api?.dbGetDocument) {
    return { ok: false, error: "Local DB not available", row: null };
  }
  return api.dbGetDocument(table, id);
}

export async function localListByEntity(
  companyId: string,
  entityType?: string | null,
  limit?: number,
) {
  const api = desktop();
  if (!api?.dbListLocalDocuments) {
    return { ok: false, error: "Local DB not available", rows: [] };
  }
  return api.dbListLocalDocuments(companyId, entityType, limit);
}

export async function localGetLocalDocument(id: string) {
  const api = desktop();
  if (!api?.dbGetLocalDocument) {
    return { ok: false, error: "Local DB not available", row: null };
  }
  return api.dbGetLocalDocument(id);
}

export async function localListOutbox(
  companyId: string,
  status = "pending",
  limit?: number,
) {
  const api = desktop();
  if (!api?.dbListOutbox) {
    return { ok: false, error: "Local DB not available", rows: [] };
  }
  return api.dbListOutbox(companyId, status, limit);
}

export async function localMarkEntitySynced(
  entityType: string,
  entityId: string,
  syncStatus = "synced",
) {
  const api = desktop();
  if (!api?.dbMarkEntitySynced) {
    return { ok: false, error: "Local DB not available" };
  }
  return api.dbMarkEntitySynced(entityType, entityId, syncStatus);
}

export async function localBootstrapCompany(
  companyId: string,
  snapshot: Record<string, unknown>,
) {
  const api = desktop();
  if (!api?.dbBootstrapCompany) {
    return { ok: false, error: "Local DB not available" };
  }
  return api.dbBootstrapCompany(companyId, snapshot);
}

/** Map IndexedDB / app cache store → SQLite entity_type for generic docs. */
export const CACHE_STORE_TO_ENTITY: Partial<Record<string, string>> = {
  sale_returns: "sale_return",
  purchase_returns: "purchase_return",
  expenses: "expense",
  stock_transfers: "stock_transfer",
  gate_passes: "gate_pass",
  load_sheets: "load_sheet",
  expiry_receipts: "expiry_receipt",
  expiry_claims: "expiry_claim",
};

export const MASTER_CACHE_TO_SQLITE: Partial<
  Record<string, LocalMasterTable>
> = {
  parties: "parties",
  products: "products",
  warehouses: "warehouses",
  stock_balances: "stock_balances",
  salesmen: "salesmen",
  company_locations: "company_locations",
};

// ── Batched / performance helpers ─────────────────────────────────

/**
 * Fetch local_documents for multiple entity types in a single IPC call.
 * Eliminates the voucher-read N-IPC loop.
 */
export async function localListDocumentsByTypes(
  companyId: string,
  entityTypes: string[],
  limit?: number,
) {
  const api = desktop();
  if (!api?.dbListLocalDocumentsByTypes) {
    return { ok: false, error: "Local DB not available", rows: [] };
  }
  return api.dbListLocalDocumentsByTypes(companyId, entityTypes, limit);
}

/**
 * Bulk upsert stock_balances in one transaction via a single IPC call.
 */
export async function localBulkUpsertStockBalances(
  companyId: string,
  changes: Record<string, unknown>[],
) {
  const api = desktop();
  if (!api?.dbBulkUpsertStockBalances) {
    return { ok: false, error: "Local DB not available", count: 0 };
  }
  return api.dbBulkUpsertStockBalances(companyId, changes);
}

export type BatchQuerySpec = {
  store: string;
  companyId: string;
  entityType?: string;
  entityTypes?: string[];
  limit?: number;
};

/**
 * Execute multiple read queries in a single IPC round-trip.
 * Returns results in the same order as the specs.
 */
export async function localBatchQuery(
  specs: BatchQuerySpec[],
): Promise<{ ok: boolean; error?: string; results: Record<string, unknown>[][] }> {
  const api = desktop();
  if (!api?.dbBatchQuery) {
    return { ok: false, error: "Local DB not available", results: [] };
  }
  const res = await api.dbBatchQuery(specs);
  return { ok: res.ok, error: res.error, results: res.results || [] };
}

/**
 * Migrate historical LOCAL- document numbers in SQLite to standard SI- / PI- sequential numbers.
 */
export async function localMigrateLegacyDocNos(
  companyId: string,
): Promise<{ ok: boolean; error?: string; count?: number }> {
  const api = desktop();
  if (!api?.dbMigrateLegacyDocNos) {
    return { ok: false, error: "Local DB not available", count: 0 };
  }
  return api.dbMigrateLegacyDocNos(companyId);
}

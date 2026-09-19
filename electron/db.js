/**
 * Local SQLite ledger (Electron main process).
 * Source of truth for desktop offline work; cloud sync comes later.
 */
const { app } = require("electron");
const fs = require("fs");
const path = require("path");

let Database = null;
let db = null;
let logFn = console.log;

function tryLoadDatabase() {
  if (Database) return Database;
  try {
    Database = require("better-sqlite3");
    return Database;
  } catch (err) {
    throw new Error(
      `better-sqlite3 failed to load: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function dbDir() {
  const dir = path.join(app.getPath("userData"), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function dbPath() {
  return path.join(dbDir(), "umar-local.sqlite");
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  code TEXT,
  name_en TEXT,
  name_ur TEXT,
  phone TEXT,
  city TEXT,
  route TEXT,
  party_type TEXT,
  credit_limit REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  payload TEXT,
  updated_at TEXT,
  sync_status TEXT DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_parties_company ON parties(company_id);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  code TEXT,
  name_en TEXT,
  name_ur TEXT,
  unit TEXT,
  sale_price REAL DEFAULT 0,
  purchase_price REAL DEFAULT 0,
  reorder_level REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  payload TEXT,
  updated_at TEXT,
  sync_status TEXT DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_products_company ON products(company_id);

CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT,
  code TEXT,
  is_active INTEGER DEFAULT 1,
  payload TEXT,
  updated_at TEXT,
  sync_status TEXT DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_warehouses_company ON warehouses(company_id);

CREATE TABLE IF NOT EXISTS stock_balances (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  qty REAL DEFAULT 0,
  payload TEXT,
  updated_at TEXT,
  sync_status TEXT DEFAULT 'synced',
  UNIQUE(company_id, product_id, warehouse_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_company ON stock_balances(company_id);

CREATE TABLE IF NOT EXISTS sale_invoices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  invoice_no TEXT,
  invoice_date TEXT,
  party_id TEXT,
  warehouse_id TEXT,
  payment_type TEXT,
  status TEXT,
  grand_total REAL DEFAULT 0,
  payload TEXT,
  updated_at TEXT,
  sync_status TEXT DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_sales_company ON sale_invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sale_invoices(company_id, invoice_date);

CREATE TABLE IF NOT EXISTS sale_invoice_lines (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  product_id TEXT,
  qty REAL DEFAULT 0,
  rate REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  payload TEXT,
  FOREIGN KEY (invoice_id) REFERENCES sale_invoices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sale_lines_invoice ON sale_invoice_lines(invoice_id);

CREATE TABLE IF NOT EXISTS purchase_invoices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  invoice_no TEXT,
  invoice_date TEXT,
  party_id TEXT,
  warehouse_id TEXT,
  status TEXT,
  grand_total REAL DEFAULT 0,
  payload TEXT,
  updated_at TEXT,
  sync_status TEXT DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_purchases_company ON purchase_invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchase_invoices(company_id, invoice_date);

CREATE TABLE IF NOT EXISTS purchase_invoice_lines (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  product_id TEXT,
  qty REAL DEFAULT 0,
  rate REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  payload TEXT,
  FOREIGN KEY (invoice_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_purchase_lines_invoice ON purchase_invoice_lines(invoice_id);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON sync_outbox(company_id, status);
CREATE INDEX IF NOT EXISTS idx_outbox_entity ON sync_outbox(entity_id);
`;

function openDb() {
  if (db) return db;
  const DB = tryLoadDatabase();
  const file = dbPath();
  db = new DB(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  migrateSchema(db);
  db.prepare(
    `INSERT INTO meta(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run("schema_version", "2");
  db.prepare(
    `INSERT INTO meta(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run("opened_at", new Date().toISOString());
  logFn(`[sqlite] opened ${file}`);
  return db;
}

function migrateSchema(database) {
  database.exec(`
CREATE TABLE IF NOT EXISTS local_documents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  doc_no TEXT,
  doc_date TEXT,
  party_id TEXT,
  status TEXT,
  amount REAL DEFAULT 0,
  payload TEXT NOT NULL,
  updated_at TEXT,
  sync_status TEXT DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_local_docs_company ON local_documents(company_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_local_docs_date ON local_documents(company_id, doc_date);

CREATE TABLE IF NOT EXISTS salesmen (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  is_active INTEGER DEFAULT 1,
  payload TEXT,
  updated_at TEXT,
  sync_status TEXT DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_salesmen_company ON salesmen(company_id);

CREATE TABLE IF NOT EXISTS company_locations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT,
  city TEXT,
  route TEXT,
  payload TEXT,
  updated_at TEXT,
  sync_status TEXT DEFAULT 'synced'
);
CREATE INDEX IF NOT EXISTS idx_locations_company ON company_locations(company_id);
`);
}

function closeDb() {
  if (db) {
    try {
      db.close();
    } catch (_) {}
    db = null;
  }
}

function ok(data) {
  return { ok: true, ...data };
}

function fail(error) {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

function parsePayload(row) {
  if (!row) return null;
  if (row.payload) {
    try {
      return { ...row, ...(JSON.parse(row.payload) || {}), payload: undefined };
    } catch {
      /* keep raw */
    }
  }
  const { payload: _p, ...rest } = row;
  return rest;
}

function enqueueOutbox(database, row) {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO sync_outbox(
        id, company_id, entity_type, entity_id, operation, payload, status, attempts, created_at, updated_at
      ) VALUES (@id, @company_id, @entity_type, @entity_id, @operation, @payload, 'pending', 0, @created_at, @updated_at)`,
    )
    .run({
      id: row.id || require("crypto").randomUUID(),
      company_id: row.company_id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      operation: row.operation || "upsert",
      payload:
        typeof row.payload === "string"
          ? row.payload
          : JSON.stringify(row.payload || {}),
      created_at: now,
      updated_at: now,
    });
}

function getStatus() {
  try {
    const database = openDb();
    const tables = database
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all()
      .map((r) => r.name);
    const pending = database
      .prepare(`SELECT COUNT(*) AS c FROM sync_outbox WHERE status = 'pending'`)
      .get().c;
    return ok({
      path: dbPath(),
      schemaVersion: database.prepare(`SELECT value FROM meta WHERE key='schema_version'`).get()
        ?.value,
      tables,
      pendingOutbox: pending,
    });
  } catch (err) {
    return fail(err);
  }
}

function upsertMaster(table, row) {
  const allowed = {
    parties: true,
    products: true,
    warehouses: true,
    stock_balances: true,
    salesmen: true,
    company_locations: true,
  };
  if (!allowed[table]) throw new Error(`Unsupported master table: ${table}`);
  if (!row?.id || !row?.company_id) throw new Error("id and company_id required");

  const database = openDb();
  const now = new Date().toISOString();
  const payload =
    typeof row.payload === "string"
      ? row.payload
      : JSON.stringify(row.payload || row);

  if (table === "parties") {
    database
      .prepare(
        `INSERT INTO parties(
          id, company_id, code, name_en, name_ur, phone, city, route, party_type,
          credit_limit, is_active, payload, updated_at, sync_status
        ) VALUES (
          @id, @company_id, @code, @name_en, @name_ur, @phone, @city, @route, @party_type,
          @credit_limit, @is_active, @payload, @updated_at, @sync_status
        )
        ON CONFLICT(id) DO UPDATE SET
          code=excluded.code, name_en=excluded.name_en, name_ur=excluded.name_ur,
          phone=excluded.phone, city=excluded.city, route=excluded.route,
          party_type=excluded.party_type, credit_limit=excluded.credit_limit,
          is_active=excluded.is_active, payload=excluded.payload,
          updated_at=excluded.updated_at, sync_status=excluded.sync_status`,
      )
      .run({
        id: row.id,
        company_id: row.company_id,
        code: row.code || null,
        name_en: row.name_en || null,
        name_ur: row.name_ur || null,
        phone: row.phone || null,
        city: row.city || null,
        route: row.route || null,
        party_type: row.party_type || null,
        credit_limit: Number(row.credit_limit || 0),
        is_active: row.is_active === false || row.is_active === 0 ? 0 : 1,
        payload,
        updated_at: row.updated_at || now,
        sync_status: row.sync_status || "synced",
      });
  } else if (table === "products") {
    database
      .prepare(
        `INSERT INTO products(
          id, company_id, code, name_en, name_ur, unit, sale_price, purchase_price,
          reorder_level, is_active, payload, updated_at, sync_status
        ) VALUES (
          @id, @company_id, @code, @name_en, @name_ur, @unit, @sale_price, @purchase_price,
          @reorder_level, @is_active, @payload, @updated_at, @sync_status
        )
        ON CONFLICT(id) DO UPDATE SET
          code=excluded.code, name_en=excluded.name_en, name_ur=excluded.name_ur,
          unit=excluded.unit, sale_price=excluded.sale_price, purchase_price=excluded.purchase_price,
          reorder_level=excluded.reorder_level, is_active=excluded.is_active,
          payload=excluded.payload, updated_at=excluded.updated_at, sync_status=excluded.sync_status`,
      )
      .run({
        id: row.id,
        company_id: row.company_id,
        code: row.code || null,
        name_en: row.name_en || null,
        name_ur: row.name_ur || null,
        unit: row.unit || null,
        sale_price: Number(row.sale_price || 0),
        purchase_price: Number(row.purchase_price || 0),
        reorder_level: Number(row.reorder_level || 0),
        is_active: row.is_active === false || row.is_active === 0 ? 0 : 1,
        payload,
        updated_at: row.updated_at || now,
        sync_status: row.sync_status || "synced",
      });
  } else if (table === "warehouses") {
    database
      .prepare(
        `INSERT INTO warehouses(
          id, company_id, name, code, is_active, payload, updated_at, sync_status
        ) VALUES (
          @id, @company_id, @name, @code, @is_active, @payload, @updated_at, @sync_status
        )
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, code=excluded.code, is_active=excluded.is_active,
          payload=excluded.payload, updated_at=excluded.updated_at, sync_status=excluded.sync_status`,
      )
      .run({
        id: row.id,
        company_id: row.company_id,
        name: row.name || null,
        code: row.code || null,
        is_active: row.is_active === false || row.is_active === 0 ? 0 : 1,
        payload,
        updated_at: row.updated_at || now,
        sync_status: row.sync_status || "synced",
      });
  } else if (table === "stock_balances") {
    database
      .prepare(
        `INSERT INTO stock_balances(
          id, company_id, product_id, warehouse_id, qty, payload, updated_at, sync_status
        ) VALUES (
          @id, @company_id, @product_id, @warehouse_id, @qty, @payload, @updated_at, @sync_status
        )
        ON CONFLICT(id) DO UPDATE SET
          qty=excluded.qty, payload=excluded.payload,
          updated_at=excluded.updated_at, sync_status=excluded.sync_status`,
      )
      .run({
        id: row.id,
        company_id: row.company_id,
        product_id: row.product_id,
        warehouse_id: row.warehouse_id,
        qty: Number(row.qty || 0),
        payload,
        updated_at: row.updated_at || now,
        sync_status: row.sync_status || "synced",
      });
  } else if (table === "salesmen") {
    database
      .prepare(
        `INSERT INTO salesmen(
          id, company_id, name, phone, is_active, payload, updated_at, sync_status
        ) VALUES (
          @id, @company_id, @name, @phone, @is_active, @payload, @updated_at, @sync_status
        )
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, phone=excluded.phone, is_active=excluded.is_active,
          payload=excluded.payload, updated_at=excluded.updated_at, sync_status=excluded.sync_status`,
      )
      .run({
        id: row.id,
        company_id: row.company_id,
        name: row.name || row.full_name || null,
        phone: row.phone || null,
        is_active: row.is_active === false || row.is_active === 0 ? 0 : 1,
        payload,
        updated_at: row.updated_at || now,
        sync_status: row.sync_status || "synced",
      });
  } else if (table === "company_locations") {
    database
      .prepare(
        `INSERT INTO company_locations(
          id, company_id, name, city, route, payload, updated_at, sync_status
        ) VALUES (
          @id, @company_id, @name, @city, @route, @payload, @updated_at, @sync_status
        )
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, city=excluded.city, route=excluded.route,
          payload=excluded.payload, updated_at=excluded.updated_at, sync_status=excluded.sync_status`,
      )
      .run({
        id: row.id,
        company_id: row.company_id,
        name: row.name || null,
        city: row.city || null,
        route: row.route || null,
        payload,
        updated_at: row.updated_at || now,
        sync_status: row.sync_status || "synced",
      });
  }

  return { id: row.id };
}

function listMaster(table, companyId, limit = 5000) {
  const allowed = {
    parties: true,
    products: true,
    warehouses: true,
    stock_balances: true,
    salesmen: true,
    company_locations: true,
  };
  if (!allowed[table]) throw new Error(`Unsupported master table: ${table}`);
  const database = openDb();
  const rows = database
    .prepare(
      `SELECT * FROM ${table} WHERE company_id = ? ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(companyId, Math.min(Number(limit) || 5000, 20000));
  return rows.map(parsePayload);
}

function bulkUpsertMaster(table, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { count: 0 };
  const database = openDb();
  const tx = database.transaction((list) => {
    for (const row of list) upsertMaster(table, row);
  });
  tx(rows);
  return { count: rows.length };
}

function saveLocalDocument(input) {
  if (!input?.id || !input?.company_id || !input?.entity_type) {
    throw new Error("id, company_id, entity_type required");
  }
  const database = openDb();
  const now = new Date().toISOString();
  const syncStatus = input.sync_status || "pending";
  const payload =
    typeof input.payload === "string"
      ? input.payload
      : JSON.stringify(input.payload || input);

  const tx = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO local_documents(
          id, company_id, entity_type, doc_no, doc_date, party_id, status,
          amount, payload, updated_at, sync_status
        ) VALUES (
          @id, @company_id, @entity_type, @doc_no, @doc_date, @party_id, @status,
          @amount, @payload, @updated_at, @sync_status
        )
        ON CONFLICT(id) DO UPDATE SET
          doc_no=excluded.doc_no, doc_date=excluded.doc_date, party_id=excluded.party_id,
          status=excluded.status, amount=excluded.amount, payload=excluded.payload,
          updated_at=excluded.updated_at, sync_status=excluded.sync_status`,
      )
      .run({
        id: input.id,
        company_id: input.company_id,
        entity_type: input.entity_type,
        doc_no: input.doc_no || null,
        doc_date: input.doc_date || now.slice(0, 10),
        party_id: input.party_id || null,
        status: input.status || "posted",
        amount: Number(input.amount || input.grand_total || 0),
        payload,
        updated_at: now,
        sync_status: syncStatus,
      });

    if (syncStatus === "pending" && input.enqueue_outbox !== false) {
      enqueueOutbox(database, {
        company_id: input.company_id,
        entity_type: input.entity_type,
        entity_id: input.id,
        operation: input.operation || "upsert",
        payload: typeof input.payload === "object" ? input.payload : input,
      });
    }
  });
  tx();
  return { id: input.id, sync_status: syncStatus };
}

function listLocalDocuments(companyId, entityType, limit = 500) {
  const database = openDb();
  const lim = Math.min(Number(limit) || 500, 5000);
  if (entityType) {
    return database
      .prepare(
        `SELECT * FROM local_documents
         WHERE company_id = ? AND entity_type = ?
         ORDER BY doc_date DESC, updated_at DESC
         LIMIT ?`,
      )
      .all(companyId, entityType, lim)
      .map(parsePayload);
  }
  return database
    .prepare(
      `SELECT * FROM local_documents
       WHERE company_id = ?
       ORDER BY doc_date DESC, updated_at DESC
       LIMIT ?`,
    )
    .all(companyId, lim)
    .map(parsePayload);
}

function getLocalDocument(id) {
  const database = openDb();
  const row = database.prepare(`SELECT * FROM local_documents WHERE id = ?`).get(id);
  return parsePayload(row);
}

function markEntitySynced(entityType, entityId, syncStatus = "synced") {
  const database = openDb();
  const now = new Date().toISOString();
  const tx = database.transaction(() => {
    if (entityType === "sale_invoice") {
      database
        .prepare(`UPDATE sale_invoices SET sync_status=?, updated_at=? WHERE id=?`)
        .run(syncStatus, now, entityId);
    } else if (entityType === "purchase_invoice") {
      database
        .prepare(`UPDATE purchase_invoices SET sync_status=?, updated_at=? WHERE id=?`)
        .run(syncStatus, now, entityId);
    } else if (
      entityType === "party_create" ||
      entityType === "party_update" ||
      entityType === "party"
    ) {
      database
        .prepare(`UPDATE parties SET sync_status=?, updated_at=? WHERE id=?`)
        .run(syncStatus, now, entityId);
    } else if (
      entityType === "product_create" ||
      entityType === "product_update" ||
      entityType === "product"
    ) {
      database
        .prepare(`UPDATE products SET sync_status=?, updated_at=? WHERE id=?`)
        .run(syncStatus, now, entityId);
    } else if (
      entityType === "warehouse_create" ||
      entityType === "warehouse_update" ||
      entityType === "warehouse"
    ) {
      database
        .prepare(`UPDATE warehouses SET sync_status=?, updated_at=? WHERE id=?`)
        .run(syncStatus, now, entityId);
    } else {
      database
        .prepare(`UPDATE local_documents SET sync_status=?, updated_at=? WHERE id=?`)
        .run(syncStatus, now, entityId);
    }
    database
      .prepare(
        `UPDATE sync_outbox SET status=?, updated_at=? WHERE entity_id=? AND status='pending'`,
      )
      .run(syncStatus === "synced" ? "synced" : syncStatus, now, entityId);
  });
  tx();
  return { id: entityId };
}

function bootstrapCompany(companyId, snapshot) {
  if (!companyId || !snapshot || typeof snapshot !== "object") {
    throw new Error("companyId and snapshot required");
  }
  const database = openDb();
  const tx = database.transaction(() => {
    const masters = [
      "parties",
      "products",
      "warehouses",
      "stock_balances",
      "salesmen",
      "company_locations",
    ];
    for (const table of masters) {
      const rows = Array.isArray(snapshot[table]) ? snapshot[table] : [];
      for (const row of rows) {
        if (!row?.id) continue;
        upsertMaster(table, {
          ...row,
          company_id: row.company_id || companyId,
          sync_status: "synced",
        });
      }
    }

    const sales = Array.isArray(snapshot.sale_invoices) ? snapshot.sale_invoices : [];
    for (const inv of sales) {
      if (!inv?.id) continue;
      const lines = Array.isArray(inv.lines) && inv.lines.length
        ? inv.lines
        : Array.isArray(inv.items) && inv.items.length
          ? inv.items
          : Array.isArray(inv.sale_invoice_items) && inv.sale_invoice_items.length
            ? inv.sale_invoice_items
            : [];
      saveSaleInvoice({
        ...inv,
        company_id: inv.company_id || companyId,
        lines,
        sync_status: "synced",
      });
    }

    const purchases = Array.isArray(snapshot.purchase_invoices)
      ? snapshot.purchase_invoices
      : [];
    for (const inv of purchases) {
      if (!inv?.id) continue;
      const lines = Array.isArray(inv.lines) && inv.lines.length
        ? inv.lines
        : Array.isArray(inv.items) && inv.items.length
          ? inv.items
          : Array.isArray(inv.purchase_invoice_items) && inv.purchase_invoice_items.length
            ? inv.purchase_invoice_items
            : [];
      savePurchaseInvoice({
        ...inv,
        company_id: inv.company_id || companyId,
        lines,
        sync_status: "synced",
      });
    }

    const docs = Array.isArray(snapshot.local_documents) ? snapshot.local_documents : [];
    for (const doc of docs) {
      if (!doc?.id || !doc?.entity_type) continue;
      saveLocalDocument({
        ...doc,
        company_id: doc.company_id || companyId,
        sync_status: "synced",
        enqueue_outbox: false,
        payload: doc.payload || doc,
      });
    }

    database
      .prepare(
        `INSERT INTO meta(key, value) VALUES(?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(`bootstrap:${companyId}`, new Date().toISOString());
  });
  tx();
  return { ok: true, companyId };
}

function saveSaleInvoice(input) {
  if (!input?.id || !input?.company_id) throw new Error("id and company_id required");
  const database = openDb();
  const now = new Date().toISOString();
  const lines = Array.isArray(input.lines) && input.lines.length
    ? input.lines
    : Array.isArray(input.items) && input.items.length
      ? input.items
      : Array.isArray(input.sale_invoice_items) && input.sale_invoice_items.length
        ? input.sale_invoice_items
        : [];
  const syncStatus = input.sync_status || "pending";
  const payload = JSON.stringify({ ...input, lines });

  const tx = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO sale_invoices(
          id, company_id, invoice_no, invoice_date, party_id, warehouse_id,
          payment_type, status, grand_total, payload, updated_at, sync_status
        ) VALUES (
          @id, @company_id, @invoice_no, @invoice_date, @party_id, @warehouse_id,
          @payment_type, @status, @grand_total, @payload, @updated_at, @sync_status
        )
        ON CONFLICT(id) DO UPDATE SET
          invoice_no=excluded.invoice_no, invoice_date=excluded.invoice_date,
          party_id=excluded.party_id, warehouse_id=excluded.warehouse_id,
          payment_type=excluded.payment_type, status=excluded.status,
          grand_total=excluded.grand_total, payload=excluded.payload,
          updated_at=excluded.updated_at, sync_status=excluded.sync_status`,
      )
      .run({
        id: input.id,
        company_id: input.company_id,
        invoice_no: input.invoice_no || null,
        invoice_date: input.invoice_date || now.slice(0, 10),
        party_id: input.party_id || null,
        warehouse_id: input.warehouse_id || null,
        payment_type: input.payment_type || null,
        status: input.status || "draft",
        grand_total: Number(input.grand_total || 0),
        payload,
        updated_at: now,
        sync_status: syncStatus,
      });

    database.prepare(`DELETE FROM sale_invoice_lines WHERE invoice_id = ?`).run(input.id);
    const insertLine = database.prepare(
      `INSERT INTO sale_invoice_lines(
        id, company_id, invoice_id, product_id, qty, rate, amount, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const line of lines) {
      const lineId = line.id || require("crypto").randomUUID();
      insertLine.run(
        lineId,
        input.company_id,
        input.id,
        line.product_id || null,
        Number(line.qty || 0),
        Number(line.rate || 0),
        Number(line.amount || 0),
        JSON.stringify(line),
      );
    }

    if (syncStatus === "pending") {
      enqueueOutbox(database, {
        company_id: input.company_id,
        entity_type: "sale_invoice",
        entity_id: input.id,
        operation: "upsert",
        payload: { ...input, lines },
      });
    }
  });

  tx();
  return { id: input.id, sync_status: syncStatus };
}

function savePurchaseInvoice(input) {
  if (!input?.id || !input?.company_id) throw new Error("id and company_id required");
  const database = openDb();
  const now = new Date().toISOString();
  const lines = Array.isArray(input.lines) && input.lines.length
    ? input.lines
    : Array.isArray(input.items) && input.items.length
      ? input.items
      : Array.isArray(input.purchase_invoice_items) && input.purchase_invoice_items.length
        ? input.purchase_invoice_items
        : [];
  const syncStatus = input.sync_status || "pending";
  const payload = JSON.stringify({ ...input, lines });

  const tx = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO purchase_invoices(
          id, company_id, invoice_no, invoice_date, party_id, warehouse_id,
          status, grand_total, payload, updated_at, sync_status
        ) VALUES (
          @id, @company_id, @invoice_no, @invoice_date, @party_id, @warehouse_id,
          @status, @grand_total, @payload, @updated_at, @sync_status
        )
        ON CONFLICT(id) DO UPDATE SET
          invoice_no=excluded.invoice_no, invoice_date=excluded.invoice_date,
          party_id=excluded.party_id, warehouse_id=excluded.warehouse_id,
          status=excluded.status, grand_total=excluded.grand_total,
          payload=excluded.payload, updated_at=excluded.updated_at,
          sync_status=excluded.sync_status`,
      )
      .run({
        id: input.id,
        company_id: input.company_id,
        invoice_no: input.invoice_no || null,
        invoice_date: input.invoice_date || now.slice(0, 10),
        party_id: input.party_id || null,
        warehouse_id: input.warehouse_id || null,
        status: input.status || "draft",
        grand_total: Number(input.grand_total || 0),
        payload,
        updated_at: now,
        sync_status: syncStatus,
      });

    database
      .prepare(`DELETE FROM purchase_invoice_lines WHERE invoice_id = ?`)
      .run(input.id);
    const insertLine = database.prepare(
      `INSERT INTO purchase_invoice_lines(
        id, company_id, invoice_id, product_id, qty, rate, amount, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const line of lines) {
      const lineId = line.id || require("crypto").randomUUID();
      insertLine.run(
        lineId,
        input.company_id,
        input.id,
        line.product_id || null,
        Number(line.qty || 0),
        Number(line.rate || 0),
        Number(line.amount || 0),
        JSON.stringify(line),
      );
    }

    if (syncStatus === "pending") {
      enqueueOutbox(database, {
        company_id: input.company_id,
        entity_type: "purchase_invoice",
        entity_id: input.id,
        operation: "upsert",
        payload: { ...input, lines },
      });
    }
  });

  tx();
  return { id: input.id, sync_status: syncStatus };
}

function listDocuments(table, companyId, limit = 2000) {
  const allowed = {
    sale_invoices: true,
    purchase_invoices: true,
  };
  if (!allowed[table]) throw new Error(`Unsupported document table: ${table}`);
  const database = openDb();
  const lim = Math.min(Number(limit) || 2000, 20000);
  const rows = database
    .prepare(
      `SELECT * FROM ${table} WHERE company_id = ? ORDER BY invoice_date DESC, updated_at DESC LIMIT ?`,
    )
    .all(companyId, lim);

  const parsed = rows.map(parsePayload);
  const linesTable = table === "sale_invoices" ? "sale_invoice_lines" : "purchase_invoice_lines";
  const needLines = parsed.filter((r) => !Array.isArray(r.lines) || r.lines.length === 0);
  if (needLines.length > 0) {
    try {
      const ids = needLines.map((r) => r.id);
      const placeholders = ids.map(() => "?").join(",");
      const allLines = database
        .prepare(`SELECT * FROM ${linesTable} WHERE invoice_id IN (${placeholders}) ORDER BY id`)
        .all(...ids)
        .map(parsePayload);
      const linesByInvoice = new Map();
      for (const l of allLines) {
        const list = linesByInvoice.get(l.invoice_id) || [];
        list.push(l);
        linesByInvoice.set(l.invoice_id, list);
      }
      for (const r of parsed) {
        if (!Array.isArray(r.lines) || r.lines.length === 0) {
          r.lines = linesByInvoice.get(r.id) || [];
        }
      }
    } catch (_) {}
  }
  return parsed;
}

function migrateLegacyDocNos(companyId) {
  if (!companyId) return { count: 0 };
  const database = openDb();
  let migratedCount = 0;
  const tx = database.transaction(() => {
    // 1. Check sale_invoices
    const sales = database
      .prepare(`SELECT id, invoice_no, payload FROM sale_invoices WHERE company_id = ?`)
      .all(companyId);

    let maxNum = 0;
    for (const s of sales) {
      const m = String(s.invoice_no || "").match(/^SI-(\d+)$/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    }

    for (const s of sales) {
      if (String(s.invoice_no || "").startsWith("LOCAL-")) {
        maxNum += 1;
        const newNo = `SI-${maxNum}`;
        let payloadObj = {};
        try { payloadObj = JSON.parse(s.payload || "{}"); } catch (_) {}
        payloadObj.invoice_no = newNo;
        payloadObj.doc_no = newNo;
        payloadObj._localId = newNo;

        database
          .prepare(`UPDATE sale_invoices SET invoice_no = ?, payload = ? WHERE id = ?`)
          .run(newNo, JSON.stringify(payloadObj), s.id);

        database
          .prepare(`UPDATE sync_outbox SET payload = ? WHERE entity_id = ?`)
          .run(JSON.stringify(payloadObj), s.id);

        migratedCount += 1;
      }
    }

    // 2. Check purchase_invoices
    const purchases = database
      .prepare(`SELECT id, invoice_no, payload FROM purchase_invoices WHERE company_id = ?`)
      .all(companyId);

    let maxPi = 0;
    for (const p of purchases) {
      const m = String(p.invoice_no || "").match(/^PI-(\d+)$/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxPi) maxPi = n;
      }
    }

    for (const p of purchases) {
      if (String(p.invoice_no || "").startsWith("LOCAL-")) {
        maxPi += 1;
        const newNo = `PI-${maxPi}`;
        let payloadObj = {};
        try { payloadObj = JSON.parse(p.payload || "{}"); } catch (_) {}
        payloadObj.invoice_no = newNo;
        payloadObj.doc_no = newNo;
        payloadObj._localId = newNo;

        database
          .prepare(`UPDATE purchase_invoices SET invoice_no = ?, payload = ? WHERE id = ?`)
          .run(newNo, JSON.stringify(payloadObj), p.id);

        migratedCount += 1;
      }
    }

    // 3. Check local_documents
    const docs = database
      .prepare(`SELECT id, entity_type, doc_no, payload FROM local_documents WHERE company_id = ?`)
      .all(companyId);

    for (const d of docs) {
      if (String(d.doc_no || "").startsWith("LOCAL-")) {
        const prefix =
          d.entity_type === "sale_return" ? "SR-" :
          d.entity_type === "purchase_return" ? "PR-" :
          d.entity_type === "stock_transfer" ? "ST-" :
          d.entity_type === "gate_pass" ? "GP-" :
          d.entity_type === "load_sheet" ? "LD-" :
          d.entity_type === "cash_receipt" || d.entity_type === "recovery" ? "CR-" :
          d.entity_type === "cash_payment" ? "CP-" :
          d.entity_type === "journal_voucher" ? "JV-" :
          d.entity_type === "expense" ? "EXP-" :
          d.entity_type === "expiry_receipt" ? "EXR-" :
          d.entity_type === "expiry_claim" ? "CLM-" :
          d.entity_type === "expiry_settle" ? "SET-" : "DOC-";

        let maxDoc = 0;
        for (const other of docs) {
          if (other.entity_type === d.entity_type) {
            const m = String(other.doc_no || "").match(new RegExp(`^${prefix}(\\d+)$`, "i"));
            if (m) {
              const n = parseInt(m[1], 10);
              if (n > maxDoc) maxDoc = n;
            }
          }
        }
        const newNo = `${prefix}${maxDoc + 1}`;
        let payloadObj = {};
        try { payloadObj = JSON.parse(d.payload || "{}"); } catch (_) {}
        payloadObj.doc_no = newNo;
        payloadObj.invoice_no = newNo;

        database
          .prepare(`UPDATE local_documents SET doc_no = ?, payload = ? WHERE id = ?`)
          .run(newNo, JSON.stringify(payloadObj), d.id);

        migratedCount += 1;
      }
    }
  });
  tx();
  return { count: migratedCount };
}

function getDocument(table, id) {
  const allowed = {
    sale_invoices: true,
    purchase_invoices: true,
  };
  if (!allowed[table]) throw new Error(`Unsupported document table: ${table}`);
  const database = openDb();
  const row = database.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) return null;
  const linesTable =
    table === "sale_invoices" ? "sale_invoice_lines" : "purchase_invoice_lines";
  const lines = database
    .prepare(`SELECT * FROM ${linesTable} WHERE invoice_id = ?`)
    .all(id)
    .map(parsePayload);
  return { ...parsePayload(row), lines };
}

function listOutbox(companyId, status = "pending", limit = 100) {
  const database = openDb();
  return database
    .prepare(
      `SELECT * FROM sync_outbox
       WHERE company_id = ? AND status = ?
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(companyId, status, Math.min(Number(limit) || 100, 1000))
    .map((r) => ({
      ...r,
      payload: (() => {
        try {
          return JSON.parse(r.payload);
        } catch {
          return r.payload;
        }
      })(),
    }));
}

function markOutbox(id, patch) {
  const database = openDb();
  const current = database.prepare(`SELECT * FROM sync_outbox WHERE id = ?`).get(id);
  if (!current) throw new Error("Outbox row not found");
  database
    .prepare(
      `UPDATE sync_outbox
       SET status = @status,
           attempts = @attempts,
           last_error = @last_error,
           updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id,
      status: patch.status || current.status,
      attempts:
        typeof patch.attempts === "number" ? patch.attempts : current.attempts,
      last_error:
        patch.last_error === undefined ? current.last_error : patch.last_error,
      updated_at: new Date().toISOString(),
    });
  return { id };
}

/**
 * Fetch local_documents matching multiple entity_types in a single call.
 * Eliminates N sequential IPC round-trips for voucher-style reads.
 */
function listLocalDocumentsByTypes(companyId, entityTypes, limit = 5000) {
  if (!Array.isArray(entityTypes) || entityTypes.length === 0) return [];
  const database = openDb();
  const lim = Math.min(Number(limit) || 5000, 20000);
  const placeholders = entityTypes.map(() => "?").join(",");
  return database
    .prepare(
      `SELECT * FROM local_documents
       WHERE company_id = ? AND entity_type IN (${placeholders})
       ORDER BY doc_date DESC, updated_at DESC
       LIMIT ?`,
    )
    .all(companyId, ...entityTypes, lim)
    .map(parsePayload);
}

/**
 * Bulk upsert stock_balances in a single transaction.
 * Eliminates per-line-item IPC round-trips when saving invoices offline.
 */
function bulkUpsertStockBalances(companyId, changes) {
  if (!Array.isArray(changes) || changes.length === 0) return { count: 0 };
  const database = openDb();
  const now = new Date().toISOString();
  const tx = database.transaction((list) => {
    for (const change of list) {
      const id = change.id || require("crypto").randomUUID();
      database
        .prepare(
          `INSERT INTO stock_balances(
            id, company_id, product_id, warehouse_id, qty, payload, updated_at, sync_status
          ) VALUES (
            @id, @company_id, @product_id, @warehouse_id, @qty, @payload, @updated_at, @sync_status
          )
          ON CONFLICT(id) DO UPDATE SET
            qty=excluded.qty, payload=excluded.payload,
            updated_at=excluded.updated_at, sync_status=excluded.sync_status`,
        )
        .run({
          id,
          company_id: companyId,
          product_id: change.product_id,
          warehouse_id: change.warehouse_id,
          qty: Number(change.qty || 0),
          payload: JSON.stringify(change),
          updated_at: now,
          sync_status: change.sync_status || "pending",
        });
    }
  });
  tx(changes);
  return { count: changes.length };
}

/**
 * Execute multiple read queries in a single IPC round-trip.
 * Each spec: { store, companyId, entityType?, limit? }
 * Returns an array of result arrays, matching the input order.
 */
function batchQuery(specs) {
  if (!Array.isArray(specs) || specs.length === 0) return [];
  const database = openDb();
  const results = [];

  const allowed = {
    parties: true,
    products: true,
    warehouses: true,
    stock_balances: true,
    salesmen: true,
    company_locations: true,
  };
  const docTables = {
    sale_invoices: true,
    purchase_invoices: true,
  };

  for (const spec of specs) {
    const { store, companyId, entityType, entityTypes, limit } = spec;
    const lim = Math.min(Number(limit) || 5000, 20000);

    if (allowed[store]) {
      // Master table
      const rows = database
        .prepare(
          `SELECT * FROM ${store} WHERE company_id = ? ORDER BY updated_at DESC LIMIT ?`,
        )
        .all(companyId, lim);
      results.push(rows.map(parsePayload));
    } else if (docTables[store]) {
      // Document table
      const rows = database
        .prepare(
          `SELECT * FROM ${store} WHERE company_id = ? ORDER BY invoice_date DESC, updated_at DESC LIMIT ?`,
        )
        .all(companyId, lim);
      results.push(rows.map(parsePayload));
    } else if (store === "local_documents" && Array.isArray(entityTypes) && entityTypes.length > 0) {
      // Multi-type local documents query
      const placeholders = entityTypes.map(() => "?").join(",");
      const rows = database
        .prepare(
          `SELECT * FROM local_documents
           WHERE company_id = ? AND entity_type IN (${placeholders})
           ORDER BY doc_date DESC, updated_at DESC
           LIMIT ?`,
        )
        .all(companyId, ...entityTypes, lim);
      results.push(rows.map(parsePayload));
    } else if (store === "local_documents" && entityType) {
      // Single entity type
      const rows = database
        .prepare(
          `SELECT * FROM local_documents
           WHERE company_id = ? AND entity_type = ?
           ORDER BY doc_date DESC, updated_at DESC
           LIMIT ?`,
        )
        .all(companyId, entityType, lim);
      results.push(rows.map(parsePayload));
    } else if (store === "local_documents") {
      // All local documents
      const rows = database
        .prepare(
          `SELECT * FROM local_documents
           WHERE company_id = ?
           ORDER BY doc_date DESC, updated_at DESC
           LIMIT ?`,
        )
        .all(companyId, lim);
      results.push(rows.map(parsePayload));
    } else {
      results.push([]);
    }
  }
  return results;
}

function registerDbIpc(ipcMain, log) {
  if (typeof log === "function") logFn = log;

  ipcMain.handle("db:status", () => {
    try {
      return getStatus();
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("db:upsertMaster", (_e, table, row) => {
    try {
      return ok(upsertMaster(table, row));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("db:listMaster", (_e, table, companyId, limit) => {
    try {
      return ok({ rows: listMaster(table, companyId, limit) });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("db:saveSaleInvoice", (_e, input) => {
    try {
      return ok(saveSaleInvoice(input));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("db:savePurchaseInvoice", (_e, input) => {
    try {
      return ok(savePurchaseInvoice(input));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("db:listDocuments", (_e, table, companyId, limit) => {
    try {
      return ok({ rows: listDocuments(table, companyId, limit) });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("db:getDocument", (_e, table, id) => {
    try {
      return ok({ row: getDocument(table, id) });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("db:listOutbox", (_e, companyId, status, limit) => {
    try {
      return ok({ rows: listOutbox(companyId, status, limit) });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("db:markOutbox", (_e, id, patch) => {
    try {
      return ok(markOutbox(id, patch || {}));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("db:bulkUpsertMaster", (_e, table, rows) => {
    try {
      return ok(bulkUpsertMaster(table, rows || []));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("db:saveLocalDocument", (_e, input) => {
    try {
      return ok(saveLocalDocument(input || {}));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("db:listLocalDocuments", (_e, companyId, entityType, limit) => {
    try {
      return ok({
        rows: listLocalDocuments(companyId, entityType || null, limit),
      });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("db:getLocalDocument", (_e, id) => {
    try {
      return ok({ row: getLocalDocument(id) });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("db:markEntitySynced", (_e, entityType, entityId, syncStatus) => {
    try {
      return ok(markEntitySynced(entityType, entityId, syncStatus || "synced"));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("db:bootstrapCompany", (_e, companyId, snapshot) => {
    try {
      return ok(bootstrapCompany(companyId, snapshot || {}));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("db:listLocalDocumentsByTypes", (_e, companyId, entityTypes, limit) => {
    try {
      return ok({ rows: listLocalDocumentsByTypes(companyId, entityTypes || [], limit) });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("db:bulkUpsertStockBalances", (_e, companyId, changes) => {
    try {
      return ok(bulkUpsertStockBalances(companyId, changes || []));
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("db:batchQuery", (_e, specs) => {
    try {
      return ok({ results: batchQuery(specs || []) });
    } catch (err) {
      return fail(err);
    }
  });

  ipcMain.handle("db:migrateLegacyDocNos", (_e, companyId) => {
    try {
      return ok(migrateLegacyDocNos(companyId));
    } catch (err) {
      return fail(err);
    }
  });

  app.on("before-quit", () => closeDb());
}

module.exports = {
  openDb,
  closeDb,
  dbPath,
  getStatus,
  registerDbIpc,
};

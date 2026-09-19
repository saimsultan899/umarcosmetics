const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("umarDesktop", {
  isDesktop: true,
  vaultExists: () => ipcRenderer.invoke("vault:exists"),
  vaultMeta: () => ipcRenderer.invoke("vault:meta"),
  vaultSave: (payload) => ipcRenderer.invoke("vault:save", payload),
  vaultUnlock: (pin) => ipcRenderer.invoke("vault:unlock", pin),
  vaultClear: () => ipcRenderer.invoke("vault:clear"),
  isOnline: () => ipcRenderer.invoke("desktop:isOnline"),
  /** Opens PDF print preview (avoids Windows “no print preview” dialog). */
  printPreview: () => ipcRenderer.invoke("desktop:printPreview"),
  /** System print dialog */
  print: () => ipcRenderer.invoke("desktop:print"),

  // Local SQLite ledger
  dbStatus: () => ipcRenderer.invoke("db:status"),
  dbUpsertMaster: (table, row) => ipcRenderer.invoke("db:upsertMaster", table, row),
  dbListMaster: (table, companyId, limit) =>
    ipcRenderer.invoke("db:listMaster", table, companyId, limit),
  dbSaveSaleInvoice: (input) => ipcRenderer.invoke("db:saveSaleInvoice", input),
  dbSavePurchaseInvoice: (input) =>
    ipcRenderer.invoke("db:savePurchaseInvoice", input),
  dbSaveLocalDocument: (input) =>
    ipcRenderer.invoke("db:saveLocalDocument", input),
  dbListDocuments: (table, companyId, limit) =>
    ipcRenderer.invoke("db:listDocuments", table, companyId, limit),
  dbGetDocument: (table, id) => ipcRenderer.invoke("db:getDocument", table, id),
  dbListLocalDocuments: (companyId, entityType, limit) =>
    ipcRenderer.invoke("db:listLocalDocuments", companyId, entityType, limit),
  dbGetLocalDocument: (id) => ipcRenderer.invoke("db:getLocalDocument", id),
  dbBulkUpsertMaster: (table, rows) =>
    ipcRenderer.invoke("db:bulkUpsertMaster", table, rows),
  dbListOutbox: (companyId, status, limit) =>
    ipcRenderer.invoke("db:listOutbox", companyId, status, limit),
  dbMarkOutbox: (id, patch) => ipcRenderer.invoke("db:markOutbox", id, patch),
  dbMarkEntitySynced: (entityType, entityId, syncStatus) =>
    ipcRenderer.invoke("db:markEntitySynced", entityType, entityId, syncStatus),
  dbBootstrapCompany: (companyId, snapshot) =>
    ipcRenderer.invoke("db:bootstrapCompany", companyId, snapshot),

  // ── Batched / performance IPC ──────────────────────────────────
  dbListLocalDocumentsByTypes: (companyId, entityTypes, limit) =>
    ipcRenderer.invoke("db:listLocalDocumentsByTypes", companyId, entityTypes, limit),
  dbBulkUpsertStockBalances: (companyId, changes) =>
    ipcRenderer.invoke("db:bulkUpsertStockBalances", companyId, changes),
  dbBatchQuery: (specs) =>
    ipcRenderer.invoke("db:batchQuery", specs),
  dbMigrateLegacyDocNos: (companyId) =>
    ipcRenderer.invoke("db:migrateLegacyDocNos", companyId),
});

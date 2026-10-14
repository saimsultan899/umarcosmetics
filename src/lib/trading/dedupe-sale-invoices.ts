/** Fingerprint for accidental duplicate posts (same party, day, total). */
export function saleInvoiceDedupeKey(row: Record<string, unknown>): string {
  const party = String(row.party_id || "").trim();
  const date = String(row.invoice_date || "").slice(0, 10);
  const total = (Number(row.grand_total) || 0).toFixed(2);
  return `${party}|${date}|${total}`;
}

function invoiceNoRank(raw: unknown): number {
  const s = String(raw || "");
  const m = s.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

function isPostedRow(row: Record<string, unknown>): boolean {
  const status = String(row.status || "posted").toLowerCase();
  return status === "posted";
}

function isSyncedRow(row: Record<string, unknown>): boolean {
  const sync = String(
    (row as { _syncStatus?: string })._syncStatus || row.sync_status || "",
  ).toLowerCase();
  return sync === "synced" || (!sync && isPostedRow(row));
}

/** Pick the row to keep when several represent the same sale. */
export function pickCanonicalSaleInvoice<T extends Record<string, unknown>>(
  group: T[],
): T {
  return [...group].sort((a, b) => {
    const postedA = isPostedRow(a) ? 0 : 1;
    const postedB = isPostedRow(b) ? 0 : 1;
    if (postedA !== postedB) return postedA - postedB;

    const syncA = isSyncedRow(a) ? 0 : 1;
    const syncB = isSyncedRow(b) ? 0 : 1;
    if (syncA !== syncB) return syncA - syncB;

    const noA = invoiceNoRank(a.invoice_no ?? a._localId);
    const noB = invoiceNoRank(b.invoice_no ?? b._localId);
    if (noA !== noB) return noA - noB;

    return String(a.id || "").localeCompare(String(b.id || ""));
  })[0];
}

/** One list row per party/date/total (keeps first invoice number). */
export function dedupeSaleInvoiceRows<T extends Record<string, unknown>>(
  rows: T[],
): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = saleInvoiceDedupeKey(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const out: T[] = [];
  for (const group of groups.values()) {
    out.push(pickCanonicalSaleInvoice(group));
  }
  return out;
}

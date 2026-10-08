export type ProductBarcodeEntry = {
  barcode: string;
  label: string;
};

function text(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function payloadOf(row: Record<string, unknown>) {
  const payload = row.payload;
  if (typeof payload === "string" && payload) {
    try {
      return asRecord(JSON.parse(payload));
    } catch {
      return {};
    }
  }
  if (payload && typeof payload === "object") return asRecord(payload);
  return {};
}

function parseList(value: unknown): ProductBarcodeEntry[] {
  if (!Array.isArray(value)) return [];
  const rows: ProductBarcodeEntry[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const barcode = item.trim();
      if (barcode) rows.push({ barcode, label: "" });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const barcode = text(record.barcode);
    if (!barcode) continue;
    rows.push({ barcode, label: text(record.label) });
  }
  return rows;
}

/** Every barcode saved on the product, first one first. */
export function readProductBarcodes(product: unknown): ProductBarcodeEntry[] {
  const row = asRecord(product);
  const payload = payloadOf(row);
  const primary = text(row.barcode) || text(payload.barcode);
  const extras = parseList(row.extra_barcodes ?? payload.extra_barcodes);
  if (!extras.length) {
    return primary ? [{ barcode: primary, label: "" }] : [];
  }

  // Keep the primary first when older rows stored extras without it.
  const seen = new Set(extras.map((item) => item.barcode.toLowerCase()));
  if (primary && !seen.has(primary.toLowerCase())) {
    return [{ barcode: primary, label: "" }, ...extras];
  }
  return extras;
}

export function productBarcodeValues(product: unknown) {
  return readProductBarcodes(product).map((row) => row.barcode);
}

export function formatProductBarcodes(product: unknown) {
  const rows = readProductBarcodes(product);
  if (!rows.length) return "";
  return rows
    .map((row) => (row.label ? `${row.barcode} (${row.label})` : row.barcode))
    .join(", ");
}

/** Full list for save. The first barcode is also stored on products.barcode. */
export function barcodesForSave(rows: ProductBarcodeEntry[]) {
  const seen = new Set<string>();
  const extra_barcodes: ProductBarcodeEntry[] = [];
  for (const row of rows) {
    const barcode = row.barcode.trim();
    if (!barcode) continue;
    const key = barcode.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    extra_barcodes.push({ barcode, label: row.label.trim() });
  }
  return {
    barcode: extra_barcodes[0]?.barcode || null,
    extra_barcodes,
  };
}

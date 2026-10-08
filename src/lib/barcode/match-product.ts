import { productBarcodeValues } from "@/lib/barcode/product-barcodes";
import type { Product } from "@/lib/types/database";

function text(value: unknown) {
  if (value == null) return "";
  return String(value).trim();
}

/** Barcode may sit on the row or inside a stored payload blob. */
export function productBarcode(product: Product | Record<string, unknown>) {
  const row = product as Record<string, unknown>;
  const direct = text(row.barcode);
  if (direct) return direct;

  const payload = row.payload;
  if (typeof payload === "string" && payload) {
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      return text(parsed?.barcode);
    } catch {
      return "";
    }
  }
  if (payload && typeof payload === "object") {
    return text((payload as Record<string, unknown>).barcode);
  }
  return "";
}

/** Match a typed code or a scanned barcode (exact, case-insensitive). */
export function findProductByCodeOrBarcode(
  products: Array<Product | Record<string, unknown>>,
  raw: string,
): Product | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase();
  const byCode = products.find(
    (p) => text((p as Product).code).toLowerCase() === key,
  );
  if (byCode) return byCode as Product;
  const byBarcode = products.find((p) =>
    productBarcodeValues(p).some((barcode) => barcode.toLowerCase() === key),
  );
  return (byBarcode as Product | undefined) ?? null;
}

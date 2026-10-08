import { productBarcodeValues } from "@/lib/barcode/product-barcodes";

export type ProductIdentityRow = {
  id?: string | null;
  code?: string | null;
  name_en?: string | null;
  barcode?: string | null;
  extra_barcodes?: unknown;
};

function norm(value: string | null | undefined) {
  return String(value || "").trim();
}

function looksLikePhone(barcode: string) {
  // Digits-only EAN/UPC (8–14) are allowed. Mixed phone-like strings are not.
  if (/^\d{8,14}$/.test(barcode)) return false;
  return /^\+?\d[\d\s().-]{6,}$/.test(barcode);
}

/**
 * Client-side product code / barcode rules (mirrors DB guards).
 * Returns an alert message, or null when valid.
 */
export function validateProductIdentity(input: {
  code: string;
  barcode?: string;
  barcodes?: string[];
  productId?: string | null;
  catalog: ProductIdentityRow[];
}): string | null {
  const code = norm(input.code);
  const barcodes = (input.barcodes?.length ? input.barcodes : [input.barcode || ""])
    .map((value) => norm(value))
    .filter(Boolean);
  const selfId = input.productId ? String(input.productId) : null;

  if (!code) {
    return "Product code is required.";
  }

  const codeClash = input.catalog.find((row) => {
    if (!row) return false;
    if (selfId && String(row.id || "") === selfId) return false;
    return norm(row.code).toLowerCase() === code.toLowerCase();
  });
  if (codeClash) {
    return `Product code ${code} already exists (${codeClash.name_en || "another product"}). Use a different code.`;
  }

  const seen = new Set<string>();
  for (const barcode of barcodes) {
    const key = barcode.toLowerCase();
    if (seen.has(key)) {
      return `Barcode ${barcode} is listed more than once on this product.`;
    }
    seen.add(key);

    if (key === code.toLowerCase()) {
      return `Barcode cannot be the same as the product code (${code}). Scan the real barcode or leave barcode empty.`;
    }

    if (looksLikePhone(barcode)) {
      return `Barcode looks like a phone number (${barcode}). Enter a product barcode instead.`;
    }

    const barcodeClash = input.catalog.find((row) => {
      if (!row) return false;
      if (selfId && String(row.id || "") === selfId) return false;
      return productBarcodeValues(row).some((value) => value.toLowerCase() === key);
    });
    if (barcodeClash) {
      return `Barcode ${barcode} is already used by product ${barcodeClash.code || "?"} — ${barcodeClash.name_en || "another product"}. Use a different barcode.`;
    }

    const codeAsBarcode = input.catalog.find((row) => {
      if (!row) return false;
      if (selfId && String(row.id || "") === selfId) return false;
      return norm(row.code).toLowerCase() === key;
    });
    if (codeAsBarcode) {
      return `Barcode ${barcode} matches another product code (${codeAsBarcode.code} — ${codeAsBarcode.name_en || "product"}). Do not put an item code in the barcode field.`;
    }
  }

  return null;
}

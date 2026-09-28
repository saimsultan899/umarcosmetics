import type { Product } from "@/lib/types/database";

/** Match a typed code or a scanned barcode (exact, case-insensitive). */
export function findProductByCodeOrBarcode(
  products: Product[],
  raw: string,
): Product | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const key = trimmed.toLowerCase();
  return (
    products.find((p) => p.code.trim().toLowerCase() === key) ||
    products.find((p) => (p.barcode || "").trim().toLowerCase() === key) ||
    null
  );
}

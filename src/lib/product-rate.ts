import type { Product } from "@/lib/types/database";
import { formatPkr } from "@/lib/utils";

export type RateField = "sale_rate" | "purchase_rate" | "retail_rate";

type RateProduct = Pick<
  Product,
  "sale_rate" | "purchase_rate" | "retail_rate" | "wholesale_rate"
>;

/** Pick first positive rate from preferred field, then sensible fallbacks. */
export function resolveProductRate(
  product: RateProduct,
  rateField: RateField = "sale_rate",
) {
  const order: RateField[] =
    rateField === "purchase_rate"
      ? ["purchase_rate", "retail_rate", "sale_rate"]
      : rateField === "retail_rate"
        ? ["retail_rate", "sale_rate", "purchase_rate"]
        : ["sale_rate", "retail_rate", "purchase_rate"];

  const seen = new Set<string>();
  for (const field of [rateField, ...order, "wholesale_rate" as const]) {
    if (seen.has(field)) continue;
    seen.add(field);
    const value = Number(
      (product as Record<string, unknown>)[field] ?? 0,
    );
    if (value > 0) return value;
  }
  return 0;
}

/** Piece rate for product dropdowns (right-side hint). Catalog rates are per piece. */
export function productPieceRateMeta(
  product: RateProduct,
  rateField: RateField = "sale_rate",
): string | undefined {
  const rate = resolveProductRate(product, rateField);
  if (!(rate > 0)) return undefined;
  return formatPkr(rate);
}

export function rateSourceLabel(
  product: RateProduct,
  rateField: RateField,
  rate: number,
) {
  if (rate <= 0) return "No catalog rate";
  const pairs: Array<[string, number]> = [
    ["Sale rate", Number(product.sale_rate || 0)],
    ["Retail rate", Number(product.retail_rate || 0)],
    ["Purchase rate", Number(product.purchase_rate || 0)],
    ["Wholesale rate", Number(product.wholesale_rate || 0)],
  ];
  const hit = pairs.find(([, v]) => v === rate);
  if (hit) return `Auto · ${hit[0]}`;
  if (rateField === "purchase_rate") return "Auto · Purchase rate";
  return "Auto · Catalog rate";
}

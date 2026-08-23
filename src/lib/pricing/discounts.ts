/**
 * Discount / scheme engine.
 *
 * Pakistani distributors record trade offers as free text on the product
 * (`product.scheme`) and per line (`LineItemDraft.scheme`). This module turns
 * that text into a structured rule and computes, for a given line, the rupee
 * discount and/or free-goods quantity it implies.
 *
 * The app's line total is `qty*rate - discount` (see calcLineAmount) and there
 * is no free-goods column yet, so the caller decides how to apply the result:
 *   - percent / flat / per-unit  → set the existing `discount` (rupees).
 *   - free-goods (N+M deals)     → either raise `qty` by the free units at rate 0
 *                                  or book their value as `discount`; the engine
 *                                  returns both `freeQty` and `discountValue` so
 *                                  the UI can pick. Persisting free-goods as its
 *                                  own field is a Phase-4 DB change.
 *
 * Supported notations (case-insensitive), matching how PK trade writes them:
 *   "5%"            → 5% off
 *   "5+2%" / "5% + 2%" → cascading 5% then 2%
 *   "Rs 50" / "50/-"   → flat Rs 50 off the line
 *   "10/pc" / "Rs 10 per piece" → Rs 10 off each piece
 *   "10+1" / "10+1 free"        → free-goods: buy 10, get 1 free
 *   ""/unknown        → no discount (kind "none"), never throws
 *
 * Pure and dependency-free.
 */

export type SchemeRule =
  | { kind: "percent"; rates: number[] }
  | { kind: "flat"; amount: number }
  | { kind: "per_unit"; amount: number }
  | { kind: "free_goods"; buy: number; free: number }
  | { kind: "none" };

export type SchemeResult = {
  /** rupee discount to book against the line (0 for pure free-goods) */
  discount: number;
  /** bonus pieces the deal grants (0 unless free_goods) */
  freeQty: number;
  /** rupee value of the free pieces, if the caller prefers to book it as discount */
  discountValue: number;
  kind: SchemeRule["kind"];
  /** short human summary, e.g. "5%+2%", "10+1 free" */
  label: string;
};

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number): number {
  return Math.round((num(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Parse a scheme string into a structured rule. Order matters: a trailing "%"
 * marks a percentage cascade and must win over the "N+M" free-goods reading of
 * the same "+".
 */
export function parseScheme(text: unknown): SchemeRule {
  const raw = String(text ?? "").trim();
  if (!raw) return { kind: "none" };
  const s = raw.toLowerCase();

  // Percentage(s): anything containing "%". Split on "+" or "," and read each number.
  if (s.includes("%")) {
    const rates = s
      .split(/[+,]/)
      .map((tok) => {
        const m = tok.match(/(\d+(?:\.\d+)?)\s*%?/);
        return m ? num(m[1]) : NaN;
      })
      .filter((r) => Number.isFinite(r) && r > 0) as number[];
    return rates.length ? { kind: "percent", rates } : { kind: "none" };
  }

  // Per-unit rupees: "10/pc", "Rs 10 per piece", "10 per pc"
  if (/\/\s*(pc|pcs|piece|unit)\b/.test(s) || /\bper\s*(pc|pcs|piece|unit)\b/.test(s)) {
    const m = s.match(/(\d+(?:\.\d+)?)/);
    return m ? { kind: "per_unit", amount: num(m[1]) } : { kind: "none" };
  }

  // Free-goods deal: "10+1", "10 + 1 free", "144+12"
  const deal = s.match(/(\d+)\s*\+\s*(\d+)/);
  if (deal) {
    const buy = num(deal[1]);
    const free = num(deal[2]);
    if (buy > 0 && free > 0) return { kind: "free_goods", buy, free };
  }

  // Flat rupees: "Rs 50", "₨50", "50/-", or a bare number
  const flat = s.match(/(?:rs\.?|₨|rupees)?\s*(\d+(?:\.\d+)?)\s*(?:\/-|\/=|rs)?/);
  if (flat && num(flat[1]) > 0) return { kind: "flat", amount: num(flat[1]) };

  return { kind: "none" };
}

function labelFor(rule: SchemeRule): string {
  switch (rule.kind) {
    case "percent":
      return rule.rates.map((r) => `${r}%`).join("+");
    case "flat":
      return `Rs ${round2(rule.amount)} off`;
    case "per_unit":
      return `Rs ${round2(rule.amount)}/pc`;
    case "free_goods":
      return `${rule.buy}+${rule.free} free`;
    default:
      return "—";
  }
}

/**
 * Apply a parsed rule to a line (qty in pieces, rate per piece).
 * Never returns a discount larger than the gross line value.
 */
export function applyScheme(
  rule: SchemeRule,
  qty: unknown,
  rate: unknown,
): SchemeResult {
  const q = Math.max(0, num(qty));
  const r = Math.max(0, num(rate));
  const gross = q * r;
  const base: SchemeResult = {
    discount: 0,
    freeQty: 0,
    discountValue: 0,
    kind: rule.kind,
    label: labelFor(rule),
  };

  switch (rule.kind) {
    case "percent": {
      let remaining = gross;
      for (const rate_ of rule.rates) {
        remaining *= 1 - Math.min(100, Math.max(0, rate_)) / 100;
      }
      base.discount = round2(Math.min(gross, gross - remaining));
      base.discountValue = base.discount;
      return base;
    }
    case "flat": {
      base.discount = round2(Math.min(gross, rule.amount));
      base.discountValue = base.discount;
      return base;
    }
    case "per_unit": {
      base.discount = round2(Math.min(gross, rule.amount * q));
      base.discountValue = base.discount;
      return base;
    }
    case "free_goods": {
      // "buy N get M free": for the PAID qty q, bonus = floor(q / buy) * free.
      const bundles = Math.floor(q / rule.buy);
      base.freeQty = bundles * rule.free;
      base.discountValue = round2(base.freeQty * r);
      // free-goods is not a price discount by default; leave `discount` at 0.
      return base;
    }
    default:
      return base;
  }
}

/** Convenience: parse text and apply in one call. */
export function computeLineScheme(
  text: unknown,
  qty: unknown,
  rate: unknown,
): SchemeResult {
  return applyScheme(parseScheme(text), qty, rate);
}

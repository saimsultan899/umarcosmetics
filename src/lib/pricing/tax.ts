/**
 * Tax engine — Pakistan FBR sales tax for FMCG distribution.
 *
 * Covers the fields a PK distributor's invoice needs:
 *   - GST / sales tax     — standard rate 18% (FBR, current), per-item overridable
 *   - Further tax         — extra 3% on supplies to *unregistered* buyers
 *   - FED                 — Federal Excise Duty on specific goods (e.g. aerated
 *                           drinks), charged in VAT mode alongside GST
 *
 * Taxable value is the line NET (after any scheme/discount). Two price modes:
 *   - exclusive (default): tax is added on top of the taxable value
 *   - inclusive: the given amount already contains GST; we extract it so the
 *     net + gst reconstructs the same gross (further tax / FED stay additive)
 *
 * NOTE: nothing here is persisted yet — the sale/purchase RPCs don't accept tax
 * columns. This engine computes the numbers; wiring them into the payload and
 * DB is the Phase-4 change (see docs/phase-4-wiring-spec).
 *
 * Pure and dependency-free.
 */

/** FBR standard sales-tax rate, percent. */
export const DEFAULT_GST_RATE = 18;
/** Further tax on supplies to unregistered persons, percent. */
export const DEFAULT_FURTHER_TAX_RATE = 3;

export type TaxInput = {
  /** line net after discount (pieces × rate − discount) */
  taxableValue: number;
  /** GST %, defaults to DEFAULT_GST_RATE */
  gstRate?: number;
  /** further-tax %, default 0 (set for unregistered buyers) */
  furtherTaxRate?: number;
  /** FED %, default 0 */
  fedRate?: number;
  /** true if taxableValue already includes GST */
  inclusive?: boolean;
};

export type TaxResult = {
  /** net value tax is charged on (GST removed if the input was inclusive) */
  taxableValue: number;
  gst: number;
  furtherTax: number;
  fed: number;
  totalTax: number;
  /** taxableValue + totalTax */
  gross: number;
};

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number): number {
  return Math.round((num(value) + Number.EPSILON) * 100) / 100;
}

function pct(value: unknown, fallback = 0): number {
  const n = num(value);
  return n >= 0 ? n : fallback;
}

/** Compute GST / further tax / FED for a single line. */
export function computeLineTax(input: TaxInput): TaxResult {
  const gstRate = input.gstRate === undefined ? DEFAULT_GST_RATE : pct(input.gstRate);
  const furtherRate = pct(input.furtherTaxRate);
  const fedRate = pct(input.fedRate);

  let net = Math.max(0, num(input.taxableValue));
  let gst: number;

  if (input.inclusive && gstRate > 0) {
    // amount already contains GST: net = gross / (1 + rate); gst = gross − net
    const gross = net;
    net = gross / (1 + gstRate / 100);
    gst = gross - net;
  } else {
    gst = (net * gstRate) / 100;
  }

  const furtherTax = (net * furtherRate) / 100;
  const fed = (net * fedRate) / 100;

  net = round2(net);
  gst = round2(gst);
  const furtherTaxR = round2(furtherTax);
  const fedR = round2(fed);
  const totalTax = round2(gst + furtherTaxR + fedR);

  return {
    taxableValue: net,
    gst,
    furtherTax: furtherTaxR,
    fed: fedR,
    totalTax,
    gross: round2(net + totalTax),
  };
}

/** Roll several line-tax inputs into one invoice-level total. */
export function computeInvoiceTax(lines: TaxInput[]): TaxResult {
  const acc: TaxResult = {
    taxableValue: 0,
    gst: 0,
    furtherTax: 0,
    fed: 0,
    totalTax: 0,
    gross: 0,
  };
  for (const line of lines || []) {
    const t = computeLineTax(line);
    acc.taxableValue = round2(acc.taxableValue + t.taxableValue);
    acc.gst = round2(acc.gst + t.gst);
    acc.furtherTax = round2(acc.furtherTax + t.furtherTax);
    acc.fed = round2(acc.fed + t.fed);
    acc.totalTax = round2(acc.totalTax + t.totalTax);
    acc.gross = round2(acc.gross + t.gross);
  }
  return acc;
}

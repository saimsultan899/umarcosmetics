/**
 * Unit-of-measure engine — carton ⇄ piece conversion.
 *
 * Pakistani FMCG distributors buy/sell in cartons (CTN) but stock, price and
 * invoice in individual pieces (PCS). Each product row carries `packing`: the
 * number of pieces in one carton (e.g. 12, 24, 48).
 *
 * IMPORTANT — base unit contract:
 *   The rest of the app treats a line's `qty` and `rate` in PIECES. This module
 *   never changes that. It only helps a user *think* in cartons: it converts a
 *   carton + loose-piece entry into a piece `qty`, and a per-carton price into a
 *   per-piece `rate`. Feed the results into the existing fields and the posting
 *   payload shape is unchanged.
 */

export type UomBreakdown = {
  /** whole cartons */
  cartons: number;
  /** leftover loose pieces (may be fractional if qty uses decimals) */
  pieces: number;
};

export type QtyUnitMode = "piece" | "carton";

export const CARTON_LABEL = "CTN";
export const PIECE_LABEL = "PCS";

/** Coerce anything to a finite number, else 0. */
function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Round to 2 decimals, killing binary-float drift (e.g. 0.1*3). */
export function roundMoney(value: number): number {
  return Math.round((num(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Pieces in one carton. A missing / zero / invalid `packing` means the product
 * is handled loose, so it falls back to 1 (1 piece per "carton") — that makes
 * every conversion below the identity, which is the safe no-op.
 */
export function piecesPerCarton(packing: unknown): number {
  const p = num(packing);
  return p >= 1 ? p : 1;
}

/** Does this product have a real carton pack size worth offering CTN entry for? */
export function hasCartonPacking(packing: unknown): boolean {
  return num(packing) > 1;
}

/** Short label for outer pack (Carton → CTN, Box → BOX). */
export function cartonShortLabel(unitType?: string | null): string {
  const raw = (unitType || "").trim();
  if (!raw) return CARTON_LABEL;
  const lower = raw.toLowerCase();
  if (lower.startsWith("cart")) return "CTN";
  if (lower.startsWith("box")) return "BOX";
  if (lower.startsWith("pack")) return "PK";
  return raw.slice(0, 3).toUpperCase();
}

/** Short label for base unit (Piece → PCS). */
export function pieceShortLabel(baseUnit?: string | null): string {
  const raw = (baseUnit || "").trim();
  if (!raw) return PIECE_LABEL;
  const lower = raw.toLowerCase();
  if (lower.startsWith("piec") || lower === "pcs" || lower === "pc") return "PCS";
  if (lower.startsWith("unit")) return "UNT";
  return raw.slice(0, 3).toUpperCase();
}

/** cartons + loose pieces → total pieces (the value that goes into `qty`). */
export function toPieces(
  cartons: unknown,
  loosePieces: unknown,
  packing: unknown,
): number {
  const total = num(cartons) * piecesPerCarton(packing) + num(loosePieces);
  return roundMoney(total);
}

/** total pieces → { cartons, pieces } for display. */
export function fromPieces(totalPieces: unknown, packing: unknown): UomBreakdown {
  const ppc = piecesPerCarton(packing);
  const total = Math.max(0, num(totalPieces));
  const cartons = Math.floor(total / ppc);
  const pieces = roundMoney(total - cartons * ppc);
  return { cartons, pieces };
}

/** total pieces expressed as a (possibly fractional) carton count — for reports. */
export function piecesToCartons(totalPieces: unknown, packing: unknown): number {
  return roundMoney(num(totalPieces) / piecesPerCarton(packing));
}

/**
 * Human label for a piece quantity, e.g. "12 CTN + 4 PCS", "12 CTN", "4 PCS".
 * When the product has no carton packing (ppc<=1) it degrades to "N PCS".
 */
export function formatUom(
  totalPieces: unknown,
  packing: unknown,
  labels?: { unitType?: string | null; baseUnit?: string | null },
): string {
  const ppc = piecesPerCarton(packing);
  const total = Math.max(0, num(totalPieces));
  const ctn = cartonShortLabel(labels?.unitType);
  const pcs = pieceShortLabel(labels?.baseUnit);
  if (ppc <= 1) return `${roundMoney(total)} ${pcs}`;

  const { cartons, pieces } = fromPieces(total, packing);
  const parts: string[] = [];
  if (cartons > 0) parts.push(`${cartons} ${ctn}`);
  if (pieces > 0 || cartons === 0) parts.push(`${pieces} ${pcs}`);
  return parts.join(" + ");
}

/** Compact display: "12 ctn 4 pcs" for stock lists. */
export function formatUomCompact(
  totalPieces: unknown,
  packing: unknown,
  labels?: { unitType?: string | null; baseUnit?: string | null },
): string {
  return formatUom(totalPieces, packing, labels)
    .replace(/ \+ /g, " ")
    .toLowerCase();
}

/** per-carton price → per-piece rate (the value that goes into `rate`). */
export function perPieceRate(perCartonRate: unknown, packing: unknown): number {
  return roundMoney(num(perCartonRate) / piecesPerCarton(packing));
}

/** per-piece rate → per-carton price (for showing a carton price hint). */
export function perCartonRate(perPieceRate: unknown, packing: unknown): number {
  return roundMoney(num(perPieceRate) * piecesPerCarton(packing));
}

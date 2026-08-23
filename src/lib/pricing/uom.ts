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
 *   payload shape is unchanged. (See docs/phase-4-wiring-spec — persisting the
 *   chosen unit per line is a separate, DB-level change.)
 *
 * Pure and dependency-free on purpose, so it is trivially unit-testable and
 * reusable on both server and client.
 */

export type UomBreakdown = {
  /** whole cartons */
  cartons: number;
  /** leftover loose pieces (may be fractional if qty uses decimals) */
  pieces: number;
};

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
 * Human label for a piece quantity, e.g. "20 CTN + 4 PCS", "20 CTN", "4 PCS".
 * When the product has no carton packing (ppc<=1) it degrades to "N PCS".
 */
export function formatUom(totalPieces: unknown, packing: unknown): string {
  const ppc = piecesPerCarton(packing);
  const total = Math.max(0, num(totalPieces));
  if (ppc <= 1) return `${roundMoney(total)} ${PIECE_LABEL}`;

  const { cartons, pieces } = fromPieces(total, packing);
  const parts: string[] = [];
  if (cartons > 0) parts.push(`${cartons} ${CARTON_LABEL}`);
  if (pieces > 0 || cartons === 0) parts.push(`${pieces} ${PIECE_LABEL}`);
  return parts.join(" + ");
}

/** per-carton price → per-piece rate (the value that goes into `rate`). */
export function perPieceRate(perCartonRate: unknown, packing: unknown): number {
  return roundMoney(num(perCartonRate) / piecesPerCarton(packing));
}

/** per-piece rate → per-carton price (for showing a carton price hint). */
export function perCartonRate(perPieceRate: unknown, packing: unknown): number {
  return roundMoney(num(perPieceRate) * piecesPerCarton(packing));
}

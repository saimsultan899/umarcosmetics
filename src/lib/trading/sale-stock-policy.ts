export type SaleStockPolicy = "block" | "confirm";

export function normalizeSaleStockPolicy(value: unknown): SaleStockPolicy {
  return value === "block" ? "block" : "confirm";
}

/**
 * Flag a quantity far past the shelf for a stronger warning.
 * Does not block save when the company allows oversell (confirm policy).
 */
export function saleQtyIsMistake(need: number, onHand: number): boolean {
  const wanted = Number(need);
  const shelf = Number(onHand);
  if (!(wanted > shelf + 0.0005)) return false;
  const hand = Math.max(0, Number.isFinite(shelf) ? shelf : 0);
  return wanted > hand * 10 && wanted > hand + 200;
}

export type StockLineCheck = {
  label: string;
  need: number;
  onHand: number;
};

export function reviewSaleStock(lines: StockLineCheck[], policy: SaleStockPolicy) {
  const mistakes: string[] = [];
  const shorts: string[] = [];
  for (const line of lines) {
    if (!(line.need > line.onHand + 0.0005)) continue;
    if (saleQtyIsMistake(line.need, line.onHand)) {
      mistakes.push(
        `${line.label}: entered ${line.need}, stock on hand ${line.onHand}.`,
      );
    } else {
      shorts.push(
        `${line.label}: stock on hand ${line.onHand}, selling ${line.need}.`,
      );
    }
  }
  return { mistakes, shorts, policy };
}

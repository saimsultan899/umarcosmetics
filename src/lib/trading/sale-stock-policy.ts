export type SaleStockPolicy = "block" | "confirm";

export function normalizeSaleStockPolicy(value: unknown): SaleStockPolicy {
  return value === "block" ? "block" : "confirm";
}

/**
 * A quantity this far past the shelf is treated as a typing mistake
 * for every company, including those that allow a short sale.
 * On hand 406 and a sale of 82,944 is stopped. A sale of 12 against 6 is not.
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

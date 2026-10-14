/** Shared A5/A4 line budgets — sale and purchase invoice print. */

/** A5: this many product lines per page; overflow continues on the next A5 page. */
export const A5_INVOICE_LINES_PER_PAGE = 28;

/**
 * A4: more than 40 product lines on one page with header/footer.
 * Overflow continues on the next A4 page.
 */
export const A4_INVOICE_LINES_PER_PAGE = 45;

export function preferredInvoicePaper(lineCount: number): "a5" | "a4" {
  return lineCount > A5_INVOICE_LINES_PER_PAGE ? "a4" : "a5";
}

export function chunkLines<T>(items: T[], size: number): T[][] {
  if (items.length <= size) return [items];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}

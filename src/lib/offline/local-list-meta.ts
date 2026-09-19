import type { PaginationMeta } from "@/lib/pagination";

/** Build PaginationMeta for local/offline lists (same shape as online). */
export function localPagination(total: number, pageSize: 12 | 24 | 48 | 96 = 96): PaginationMeta {
  return {
    page: 1,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize) || 1),
    from: total ? 1 : 0,
    to: total,
  };
}

export function emptyDocumentSummary(totalAmount = 0) {
  return {
    totalAmount,
    cashTotal: 0,
    creditTotal: 0,
    trend: [] as Array<{ name: string; value: number }>,
    mix: [] as Array<{ name: string; value: number }>,
  };
}

"use client";

import { PAGE_SIZE_OPTIONS } from "@/hooks/use-client-pagination";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function TablePagination({
  page,
  totalPages,
  pageSize,
  total,
  from,
  to,
  onPageChange,
  onPageSizeChange,
  loading = false,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  total: number;
  from: number;
  to: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  loading?: boolean;
}) {
  if (total === 0) {
    return (
      <div className="table-pagination flex w-full items-center justify-between gap-3 border-t border-[var(--border)] bg-white px-4 py-3 text-xs text-[var(--muted)]">
        <span>No entries</span>
        <label className="flex items-center gap-2">
          <span>Show</span>
          <select
            className="h-8 rounded-lg border border-[var(--border)] bg-white px-2 text-xs text-[var(--ink)]"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  }

  return (
    <div
      className="table-pagination flex w-full flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-xs"
      aria-busy={loading}
    >
      <p className="text-[var(--muted)]">
        Showing{" "}
        <span className="font-semibold text-[var(--ink)]">
          {from}–{to}
        </span>{" "}
        of <span className="font-semibold text-[var(--ink)]">{total}</span>{" "}
        entries
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[var(--muted)]">
          <span>Rows</span>
          <select
            className="h-8 rounded-lg border border-[var(--border)] bg-white px-2 font-medium text-[var(--ink)]"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            aria-label="Rows per page"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-white text-[var(--ink)] disabled:opacity-40"
            disabled={loading || page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[4.5rem] text-center font-medium text-[var(--ink)]">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-white text-[var(--ink)] disabled:opacity-40"
            disabled={loading || page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

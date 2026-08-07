"use client";

import { useEffect, useMemo, useState } from "react";

export const PAGE_SIZE_OPTIONS = [12, 24, 48, 96] as const;
export const DEFAULT_PAGE_SIZE = 12;

export function useClientPagination<T>(items: T[], defaultSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultSize);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);

  useEffect(() => {
    setPage(1);
  }, [items, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize;
  const end = Math.min(start + pageSize, total);

  const slice = useMemo(
    () => items.slice(start, end),
    [items, start, end],
  );

  return {
    page: safePage,
    setPage,
    pageSize,
    setPageSize: (size: number) => {
      setPageSize(size);
      setPage(1);
    },
    total,
    totalPages,
    slice,
    from: total === 0 ? 0 : start + 1,
    to: end,
  };
}

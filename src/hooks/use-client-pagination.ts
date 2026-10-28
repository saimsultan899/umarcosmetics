"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
} from "@/lib/pagination";

export { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS };

/** Brief overlay so page / page-size changes match server-paginated tables. */
const PAGE_FEEDBACK_MS = 160;

export function useClientPagination<T>(items: T[], defaultSize = DEFAULT_PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultSize);
  const [isPending, setIsPending] = useState(false);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);

  useEffect(() => {
    setPage(1);
  }, [items, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    return () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    };
  }, []);

  function withPageFeedback(fn: () => void) {
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    setIsPending(true);
    fn();
    pendingTimer.current = setTimeout(() => {
      setIsPending(false);
      pendingTimer.current = null;
    }, PAGE_FEEDBACK_MS);
  }

  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize;
  const end = Math.min(start + pageSize, total);

  const slice = useMemo(
    () => items.slice(start, end),
    [items, start, end],
  );

  return {
    page: safePage,
    setPage: (next: number) => {
      const target = Math.min(Math.max(next, 1), totalPages);
      if (target === safePage) return;
      withPageFeedback(() => setPage(target));
    },
    pageSize,
    setPageSize: (size: number) => {
      if (size === pageSize) return;
      withPageFeedback(() => {
        setPageSize(size);
        setPage(1);
      });
    },
    total,
    totalPages,
    slice,
    from: total === 0 ? 0 : start + 1,
    to: end,
    isPending,
  };
}

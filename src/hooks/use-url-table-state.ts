"use client";

import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  type PageSize,
} from "@/lib/pagination";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useTransition } from "react";

export function useUrlTableState(extraFilterKeys: string[] = []) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const rawSize = Number(searchParams.get("pageSize"));
  const pageSize: PageSize = (
    PAGE_SIZE_OPTIONS as readonly number[]
  ).includes(rawSize)
    ? (rawSize as PageSize)
    : DEFAULT_PAGE_SIZE;
  const q = searchParams.get("q") || "";

  const filters = useMemo(() => {
    const out: Record<string, string> = {};
    for (const key of extraFilterKeys) {
      const value = searchParams.get(key);
      if (value) out[key] = value;
    }
    return out;
  }, [searchParams, extraFilterKeys]);

  const pushParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      const qs = params.toString();
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname);
      });
    },
    [pathname, router, searchParams],
  );

  const setPage = useCallback(
    (next: number) => pushParams({ page: String(Math.max(1, next)) }),
    [pushParams],
  );

  const setPageSize = useCallback(
    (size: number) => pushParams({ pageSize: String(size), page: "1" }),
    [pushParams],
  );

  const setFilter = useCallback(
    (key: string, value: string | null) =>
      pushParams({ [key]: value, page: "1" }),
    [pushParams],
  );

  const setQuery = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        pushParams({ q: value.trim() || null, page: "1" });
      }, 350);
    },
    [pushParams],
  );

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  return {
    page,
    pageSize,
    q,
    filters,
    isPending,
    setPage,
    setPageSize,
    setQuery,
    setFilter,
    pushParams,
  };
}

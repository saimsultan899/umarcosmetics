"use client";

import { getDataWithFallback } from "@/lib/offline/cache-manager";
import type { CacheStoreName } from "@/lib/offline/local-db";
import { useCallback, useEffect, useState } from "react";

type OfflineDataState<T> = {
  data: T[];
  loading: boolean;
  source: "server" | "cache" | "none";
  cacheAgeMs: number | null;
  error: string | null;
  refetch: () => Promise<void>;
};

/**
 * React hook that fetches data with offline fallback.
 *
 * - Online: fetches from Supabase, caches in IndexedDB
 * - Offline: reads from IndexedDB cache
 * - Shows source indicator so UI can render "offline mode" badges
 *
 * @example
 * const { data: parties, loading, source } = useOfflineData<Party>(
 *   "parties",
 *   companyId,
 * );
 */
export function useOfflineData<T = Record<string, unknown>>(
  storeName: CacheStoreName,
  companyId: string | null | undefined,
  opts?: {
    /** Custom filter function applied to cached rows */
    filter?: (row: T) => boolean;
    /** If true, always try server first */
    forceServer?: boolean;
    /** Skip fetching (e.g. when companyId is not yet available) */
    skip?: boolean;
  },
): OfflineDataState<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"server" | "cache" | "none">("none");
  const [cacheAgeMs, setCacheAgeMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!companyId || opts?.skip) {
      setLoading(false);
      setData([]);
      setSource("none");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await getDataWithFallback<T>(storeName, companyId, {
        forceServer: opts?.forceServer,
        filter: opts?.filter,
      });
      setData(result.data);
      setSource(result.source);
      setCacheAgeMs(result.cacheAgeMs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
      setData([]);
      setSource("none");
    } finally {
      setLoading(false);
    }
  }, [storeName, companyId, opts?.skip, opts?.forceServer, opts?.filter]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { data, loading, source, cacheAgeMs, error, refetch: fetchData };
}

/**
 * Format cache age into a human-readable string.
 */
export function formatCacheAge(ageMs: number | null): string {
  if (ageMs === null) return "never synced";
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

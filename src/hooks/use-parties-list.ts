"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import { getCachedRows } from "@/lib/offline/local-db";
import {
  buildPaginationMeta,
  parsePaginationParams,
  type PaginationMeta,
} from "@/lib/pagination";
import {
  fetchPartyList,
  type PartyListResult,
  type PartyListStats,
  type PartySubtypeFilter,
  type PartyViewFilter,
} from "@/lib/queries/parties";
import { createClient } from "@/lib/supabase/client";
import type { Party, PartyType } from "@/lib/types/database";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const LEDGER_TYPES: PartyType[] = ["ASSETS", "CAPITAL", "EXPENSES", "INCOME"];

function distinctSorted(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = (raw || "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function usePartiesList({
  companyId,
  initialData,
  initialOffline = false,
}: {
  companyId: string;
  initialData?: PartyListResult | null;
  initialOffline?: boolean;
}) {
  const sync = useSyncStatus();
  const isOnline = sync ? sync.online : !initialOffline;
  const searchParams = useSearchParams();

  const [data, setData] = useState<PartyListResult | null>(initialData || null);
  const [loading, setLoading] = useState<boolean>(!initialData);
  const isFirstMount = useRef(true);

  // Convert searchParams to standard Record
  const spRecord = useMemo(() => {
    const rec: Record<string, string | string[] | undefined> = {};
    searchParams.forEach((value, key) => {
      rec[key] = value;
    });
    return rec;
  }, [searchParams]);

  const loadData = useCallback(async () => {
    if (!companyId) return;

    if (!isOnline) {
      setLoading(true);
      try {
        const { hasLocalSqlite, localListMaster } = await import(
          "@/lib/offline/sqlite-client"
        );

        let rows: Record<string, unknown>[] = [];
        if (hasLocalSqlite()) {
          const res = await localListMaster("parties", companyId);
          rows = res.rows || [];
        }
        if (!rows.length) {
          rows = await getCachedRows("parties", companyId);
        }

        const allParties = (rows as unknown as Party[]).filter(
          (p) => p.is_active !== false && (p as Record<string, unknown>).is_active !== 0,
        );

        const cityOptions = distinctSorted(allParties.map((p) => p.city || p.head));
        const sectorOptions = distinctSorted(allParties.map((p) => p.route));
        const headOptions = distinctSorted(allParties.map((p) => p.head || p.city));

        const q = (searchParams.get("q") || "").toLowerCase().trim();
        const rawView = searchParams.get("view");
        const view: PartyViewFilter =
          rawView === "ledger" || rawView === "trading" ? rawView : "all";
        const subtype = (view === "ledger"
          ? "all"
          : searchParams.get("type") || "all") as PartySubtypeFilter;
        const cityFilter = searchParams.get("city") || "";
        const sectorFilter = searchParams.get("sector") || "";
        const headFilter = searchParams.get("head") || "";

        const paginationParams = parsePaginationParams(spRecord);

        // Filter parties
        const filtered = allParties.filter((p) => {
          // View filter
          if (view === "ledger") {
            if (!LEDGER_TYPES.includes(p.party_type)) return false;
          } else if (view === "trading") {
            if (p.party_type !== "PARTY") return false;
          }

          // Subtype filter
          if (subtype === "credit") {
            if (Number(p.credit_limit || 0) <= 0) return false;
          } else if (subtype === "customer") {
            if (p.party_subtype !== "customer" && p.party_subtype !== "both") return false;
          } else if (subtype === "supplier") {
            if (p.party_subtype !== "supplier" && p.party_subtype !== "both") return false;
          } else if (subtype === "both") {
            if (p.party_subtype !== "both") return false;
          } else if (subtype === "other") {
            if (p.party_subtype !== "other") return false;
          }

          // Location filters
          if (cityFilter && (p.city || p.head) !== cityFilter) return false;
          if (sectorFilter && p.route !== sectorFilter) return false;
          if (headFilter && (p.head || p.city) !== headFilter) return false;

          // Search query
          if (q) {
            const haystack = `${p.party_code || ""} ${p.name_en || ""} ${p.name_ur || ""} ${p.city || ""} ${p.route || ""} ${p.head || ""} ${p.mobile || ""} ${p.phone || ""}`.toLowerCase();
            if (!haystack.includes(q)) return false;
          }

          return true;
        });

        // Compute stats
        const customersCount = filtered.filter(
          (p) => p.party_subtype === "customer" || p.party_subtype === "both",
        ).length;
        const suppliersCount = filtered.filter(
          (p) => p.party_subtype === "supplier" || p.party_subtype === "both",
        ).length;

        const cityCounts = new Map<string, number>();
        for (const p of filtered) {
          const c = (p.city || p.head || "No city").trim();
          cityCounts.set(c, (cityCounts.get(c) || 0) + 1);
        }
        const cityBars = [...cityCounts.entries()]
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 6);

        const ledgerMix = LEDGER_TYPES.map((type) => ({
          name: type,
          value: filtered.filter((p) => p.party_type === type).length,
        }));

        const stats: PartyListStats = {
          total: filtered.length,
          customers: customersCount,
          suppliers: suppliersCount,
          withCreditLimit: filtered.filter((p) => Number(p.credit_limit || 0) > 0).length,
          subtypeMix: [
            { name: "Customers", value: customersCount },
            { name: "Vendors", value: suppliersCount },
          ],
          ledgerMix,
          cityBars,
          mode: view,
        };

        // Paginate
        const pagination = buildPaginationMeta(filtered.length, paginationParams);
        const from = pagination.from ? pagination.from - 1 : 0;
        const to = pagination.to;
        const paged = filtered.slice(from, to);

        setData({
          parties: paged,
          pagination,
          stats,
          cityOptions,
          sectorOptions,
          headOptions,
        });
      } catch (err) {
        console.error("Failed to load offline parties list:", err);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Online
    try {
      setLoading(true);
      const supabase = createClient();
      const res = await fetchPartyList(supabase, companyId, spRecord);
      setData(res);
    } catch (err) {
      console.error("Failed to fetch online parties list:", err);
    } finally {
      setLoading(false);
    }
  }, [companyId, isOnline, searchParams, spRecord]);

  useEffect(() => {
    // If initialData was provided on the very first mount and online, keep it
    if (isFirstMount.current) {
      isFirstMount.current = false;
      if (initialData && isOnline) {
        return;
      }
    }
    void loadData();
  }, [loadData, initialData, isOnline]);

  return {
    data,
    loading,
    refetch: loadData,
  };
}

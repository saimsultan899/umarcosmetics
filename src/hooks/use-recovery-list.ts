"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import { getCachedRows } from "@/lib/offline/local-db";
import {
  buildPaginationMeta,
  parsePaginationParams,
} from "@/lib/pagination";
import {
  fetchRecoveryList,
  type RecoveryListResult,
  type RecoveryRow,
} from "@/lib/queries/recoveries";
import { createClient } from "@/lib/supabase/client";
import type { Party } from "@/lib/types/database";
import type { SalesmanOption } from "@/lib/queries/salesmen";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function distinctSorted(values: Array<string | null | undefined>): string[] {
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

export function useRecoveryList({
  companyId,
  initialData,
  initialOffline = false,
}: {
  companyId: string;
  initialData?: RecoveryListResult | null;
  initialOffline?: boolean;
}): RecoveryListResult & { loading: boolean; refetch: () => Promise<void> } {
  const sync = useSyncStatus();
  const isOnline = sync ? sync.online : !initialOffline;
  const searchParams = useSearchParams();

  const [data, setData] = useState<RecoveryListResult>(
    initialData || {
      rows: [],
      pagination: { page: 1, pageSize: 24, total: 0, totalPages: 1, from: 0, to: 0 },
      cityOptions: [],
      sectorOptions: [],
      salesmanOptions: [],
    },
  );
  const [loading, setLoading] = useState(!initialData);
  const isFirstMount = useRef(true);

  const spRecord = useMemo(() => {
    const rec: Record<string, string | string[] | undefined> = {};
    searchParams.forEach((v, k) => { rec[k] = v; });
    return rec;
  }, [searchParams]);

  const load = useCallback(async () => {
    if (!companyId) return;

    if (!isOnline) {
      setLoading(true);
      try {
        const { hasLocalSqlite, localListMaster, localListByEntity } = await import(
          "@/lib/offline/sqlite-client"
        );

        let recoveryRows: Record<string, unknown>[] = [];
        let partyRows: Record<string, unknown>[] = [];
        let salesmanRows: Record<string, unknown>[] = [];

        if (hasLocalSqlite()) {
          const [recRes, partyRes, smRes] = await Promise.all([
            localListByEntity(companyId, "recovery"),
            localListMaster("parties", companyId),
            localListMaster("salesmen", companyId),
          ]);
          recoveryRows = recRes.rows || [];
          partyRows = partyRes.rows || [];
          salesmanRows = smRes.rows || [];
        }

        if (!recoveryRows.length) recoveryRows = await getCachedRows("vouchers", companyId);
        if (!partyRows.length) partyRows = await getCachedRows("parties", companyId);
        if (!salesmanRows.length) salesmanRows = await getCachedRows("salesmen", companyId);

        const parties = partyRows as unknown as Party[];
        const salesmen = salesmanRows as unknown as SalesmanOption[];

        const q = (searchParams.get("q") || "").toLowerCase().trim();
        const cityFilter = searchParams.get("city") || "";
        const sectorFilter = searchParams.get("sector") || "";
        const salesmanFilter = searchParams.get("salesman") || "";

        // Build recovery rows with joined data
        const allRows: RecoveryRow[] = recoveryRows.map((r) => {
          const party = parties.find((p) => p.id === String(r.party_id));
          const sm = salesmen.find((s) => String((s as unknown as Record<string, unknown>).id || s.user_id) === String(r.salesman_id));
          return {
            id: String(r.id),
            recovery_date: String(r.recovery_date || r.doc_date || r.voucher_date || ""),
            amount: Number(r.amount ?? r.total_amount ?? r.grand_total ?? 0),
            city: party?.city || (r.city ? String(r.city) : null),
            route: party?.route || (r.route ? String(r.route) : null),
            remarks: r.remarks == null ? null : String(r.remarks),
            salesman_id: r.salesman_id ? String(r.salesman_id) : null,
            parties: party
              ? { party_code: party.party_code, name_en: party.name_en }
              : null,
            salesman: sm ? { full_name: sm.full_name } : null,
          };
        });

        const filtered = allRows.filter((rec) => {
          if (cityFilter && rec.city !== cityFilter) return false;
          if (sectorFilter && rec.route !== sectorFilter) return false;
          if (salesmanFilter === "unassigned" && rec.salesman_id != null) return false;
          else if (salesmanFilter && salesmanFilter !== "unassigned" && rec.salesman_id !== salesmanFilter) return false;
          if (q) {
            const text = `${rec.parties?.party_code || ""} ${rec.parties?.name_en || ""} ${rec.city || ""} ${rec.route || ""} ${rec.salesman?.full_name || ""} ${rec.remarks || ""}`.toLowerCase();
            if (!text.includes(q)) return false;
          }
          return true;
        });

        const paginationParams = parsePaginationParams(spRecord);
        const pagination = buildPaginationMeta(filtered.length, paginationParams);
        const from = pagination.from ? pagination.from - 1 : 0;
        const paged = filtered.slice(from, pagination.to);

        const salesmanOptions = salesmen
          .map((s) => ({
            value: String((s as unknown as Record<string, unknown>).id || s.user_id || ""),
            label: s.full_name || "Salesman",
          }))
          .filter((o) => o.value)
          .sort((a, b) => a.label.localeCompare(b.label));
        salesmanOptions.push({ value: "unassigned", label: "Unassigned" });

        setData({
          rows: paged,
          pagination,
          cityOptions: distinctSorted(allRows.map((r) => r.city)),
          sectorOptions: distinctSorted(allRows.map((r) => r.route)),
          salesmanOptions,
        });
      } catch (err) {
        console.error("Failed to load offline recoveries:", err);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Online
    setLoading(true);
    try {
      const supabase = createClient();
      const list = await fetchRecoveryList(supabase, companyId, spRecord);
      setData(list);
    } catch (err) {
      console.error("Failed to fetch online recoveries:", err);
    } finally {
      setLoading(false);
    }
  }, [companyId, isOnline, searchParams, spRecord]);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      if (initialData && isOnline) return;
    }
    void load();
  }, [load, initialData, isOnline]);

  return { ...data, loading, refetch: load };
}

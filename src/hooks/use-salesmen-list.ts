"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import type { SalesmanListRow } from "@/components/tables/salesmen-table";
import { getCachedRows } from "@/lib/offline/local-db";
import { createClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useRef, useState } from "react";

export type SalesmanRecord = {
  id: string;
  full_name: string;
  phone?: string | null;
  code?: string | null;
  is_active?: boolean;
  user_id?: string | null;
  created_at?: string;
};

export type SalesmanInviteRow = {
  id: string;
  email: string;
  full_name: string;
  token: string;
  claimed_by: string | null;
  created_at: string;
};

export type SalesmenListState = {
  rows: SalesmanListRow[];
  invites: SalesmanInviteRow[];
  loading: boolean;
};

export function useSalesmenList({
  companyId,
  initialRows = [],
  initialInvites = [],
  initialOffline = false,
}: {
  companyId: string;
  initialRows?: SalesmanListRow[];
  initialInvites?: SalesmanInviteRow[];
  initialOffline?: boolean;
}): SalesmenListState & { refetch: () => Promise<void> } {
  const sync = useSyncStatus();
  const isOnline = sync ? sync.online : !initialOffline;

  const [rows, setRows] = useState<SalesmanListRow[]>(initialRows);
  const [invites, setInvites] = useState<SalesmanInviteRow[]>(initialInvites);
  const [loading, setLoading] = useState(!initialRows.length);
  const isFirstMount = useRef(true);

  const load = useCallback(async () => {
    if (!companyId) return;

    if (!isOnline) {
      setLoading(true);
      try {
        const { hasLocalSqlite, localListMaster, localListByEntity } = await import(
          "@/lib/offline/sqlite-client"
        );

        let salesmanRows: Record<string, unknown>[] = [];
        let invoiceRows: Record<string, unknown>[] = [];
        let recoveryRows: Record<string, unknown>[] = [];

        if (hasLocalSqlite()) {
          const [salesmenRes, invoicesRes, recoveriesRes] = await Promise.all([
            localListMaster("salesmen", companyId),
            localListByEntity(companyId, "sale_invoice"),
            localListByEntity(companyId, "recovery"),
          ]);
          salesmanRows = salesmenRes.rows || [];
          invoiceRows = invoicesRes.rows || [];
          recoveryRows = recoveriesRes.rows || [];
        }

        if (!salesmanRows.length) salesmanRows = await getCachedRows("salesmen", companyId);
        if (!invoiceRows.length) invoiceRows = await getCachedRows("sale_invoices", companyId);
        if (!recoveryRows.length) recoveryRows = await getCachedRows("vouchers", companyId);

        const salesById = new Map<string, { bills: number; sales: number }>();
        for (const row of invoiceRows) {
          const sid = (row.salesman_id as string) || (row.salesman as string);
          if (!sid) continue;
          if (row.status && row.status !== "posted") continue;
          const cur = salesById.get(sid) || { bills: 0, sales: 0 };
          cur.bills += 1;
          cur.sales += Number(row.grand_total ?? row.amount ?? 0);
          salesById.set(sid, cur);
        }

        const recoveryById = new Map<string, { recoveries: number; recovered: number }>();
        for (const row of recoveryRows) {
          const sid = (row.salesman_id as string) || (row.salesman as string);
          if (!sid) continue;
          const cur = recoveryById.get(sid) || { recoveries: 0, recovered: 0 };
          cur.recoveries += 1;
          cur.recovered += Number(row.amount ?? row.total_amount ?? 0);
          recoveryById.set(sid, cur);
        }

        const activeSalesmen = (salesmanRows as unknown as SalesmanRecord[])
          .filter((s) => s.is_active !== false)
          .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""));

        const computedRows: SalesmanListRow[] = activeSalesmen.map((m) => {
          const s = salesById.get(m.id) || { bills: 0, sales: 0 };
          const r = recoveryById.get(m.id) || { recoveries: 0, recovered: 0 };
          return {
            id: m.id,
            full_name: m.full_name,
            phone: m.phone || null,
            code: m.code || null,
            is_active: m.is_active !== false,
            user_id: m.user_id || null,
            created_at: m.created_at || "",
            bills: s.bills,
            sales: s.sales,
            recoveries: r.recoveries,
            recovered: r.recovered,
          };
        });

        setRows(computedRows);
        setInvites([]);
      } catch (err) {
        console.error("Failed to load offline salesmen list:", err);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Online fetch
    setLoading(true);
    try {
      const supabase = createClient();
      const [{ data: roster }, { data: inviteRows }, salesAgg, recoveryAgg] =
        await Promise.all([
          supabase
            .from("salesmen")
            .select("id, full_name, phone, code, is_active, user_id, created_at")
            .eq("company_id", companyId)
            .eq("is_active", true)
            .order("full_name"),
          supabase
            .from("salesman_invites")
            .select("id, email, full_name, token, claimed_by, created_at")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .limit(50),
          supabase
            .from("sale_invoices")
            .select("salesman_id, grand_total")
            .eq("company_id", companyId)
            .eq("status", "posted")
            .not("salesman_id", "is", null),
          supabase
            .from("recoveries")
            .select("salesman_id, amount")
            .eq("company_id", companyId)
            .not("salesman_id", "is", null),
        ]);

      const salesById = new Map<string, { bills: number; sales: number }>();
      for (const row of salesAgg.data || []) {
        const id = row.salesman_id as string;
        if (!id) continue;
        const cur = salesById.get(id) || { bills: 0, sales: 0 };
        cur.bills += 1;
        cur.sales += Number(row.grand_total || 0);
        salesById.set(id, cur);
      }

      const recoveryById = new Map<string, { recoveries: number; recovered: number }>();
      for (const row of recoveryAgg.data || []) {
        const id = row.salesman_id as string;
        if (!id) continue;
        const cur = recoveryById.get(id) || { recoveries: 0, recovered: 0 };
        cur.recoveries += 1;
        cur.recovered += Number(row.amount || 0);
        recoveryById.set(id, cur);
      }

      const computedRows: SalesmanListRow[] = (roster || []).map((m) => {
        const s = salesById.get(m.id) || { bills: 0, sales: 0 };
        const r = recoveryById.get(m.id) || { recoveries: 0, recovered: 0 };
        return {
          id: m.id,
          full_name: m.full_name,
          phone: m.phone,
          code: m.code,
          is_active: m.is_active,
          user_id: m.user_id,
          created_at: m.created_at,
          bills: s.bills,
          sales: s.sales,
          recoveries: r.recoveries,
          recovered: r.recovered,
        };
      });

      setRows(computedRows);
      setInvites(
        (inviteRows || []).map((i) => ({
          id: i.id,
          email: i.email,
          full_name: i.full_name,
          token: i.token,
          claimed_by: i.claimed_by,
          created_at: i.created_at,
        })),
      );
    } catch (err) {
      console.error("Failed to load online salesmen list:", err);
    } finally {
      setLoading(false);
    }
  }, [companyId, isOnline]);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      if (initialRows.length && isOnline) return;
    }
    void load();
  }, [load, initialRows.length, isOnline]);

  return {
    rows,
    invites,
    loading,
    refetch: load,
  };
}

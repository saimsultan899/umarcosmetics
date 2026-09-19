"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import { getCachedRows } from "@/lib/offline/local-db";
import {
  buildPaginationMeta,
  parsePaginationParams,
  parsePageSize,
  type PageSize,
  type PaginationMeta,
} from "@/lib/pagination";
import { fetchExpenseList, type ExpenseRow, type ExpenseListResult } from "@/lib/queries/expenses";
import { fetchVoucherList, type VoucherRow, type VoucherListResult } from "@/lib/queries/vouchers";
import { createClient } from "@/lib/supabase/client";
import type { Party, Warehouse } from "@/lib/types/database";
import type { SalesmanOption } from "@/lib/queries/salesmen";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ── shared pagination helper ─────────────────────────────────────────────────

function offlinePaginate<T>(items: T[], spRecord: Record<string, string | string[] | undefined>) {
  const params = parsePaginationParams(spRecord);
  const meta = buildPaginationMeta(items.length, params);
  const from = meta.from ? meta.from - 1 : 0;
  return { paged: items.slice(from, meta.to), pagination: meta };
}

// ── Expenses hook ────────────────────────────────────────────────────────────

export type ExpensesState = ExpenseListResult & {
  salesmen: SalesmanOption[];
  warehouses: Warehouse[];
  vendors: Party[];
  loading: boolean;
};

export function useExpensesList({
  companyId,
  initialData,
  initialSalesmen = [],
  initialWarehouses = [],
  initialVendors = [],
  initialOffline = false,
}: {
  companyId: string;
  initialData?: ExpenseListResult | null;
  initialSalesmen?: SalesmanOption[];
  initialWarehouses?: Warehouse[];
  initialVendors?: Party[];
  initialOffline?: boolean;
}): ExpensesState & { refetch: () => Promise<void> } {
  const sync = useSyncStatus();
  const isOnline = sync ? sync.online : !initialOffline;
  const searchParams = useSearchParams();

  const [data, setData] = useState<ExpenseListResult>(
    initialData || { expenses: [], pagination: { page: 1, pageSize: 24, total: 0, totalPages: 1, from: 0, to: 0 } },
  );
  const [salesmen, setSalesmen] = useState<SalesmanOption[]>(initialSalesmen);
  const [warehouses, setWarehouses] = useState<Warehouse[]>(initialWarehouses);
  const [vendors, setVendors] = useState<Party[]>(initialVendors);
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
        const { hasLocalSqlite, localListMaster, localListByEntity } = await import("@/lib/offline/sqlite-client");

        let expenseRows: Record<string, unknown>[] = [];
        let smRows: Record<string, unknown>[] = [];
        let whRows: Record<string, unknown>[] = [];
        let partyRows: Record<string, unknown>[] = [];

        if (hasLocalSqlite()) {
          const [expRes, smRes, whRes, partyRes] = await Promise.all([
            localListByEntity(companyId, "expense"),
            localListMaster("salesmen", companyId),
            localListMaster("warehouses", companyId),
            localListMaster("parties", companyId),
          ]);
          expenseRows = expRes.rows || [];
          smRows = smRes.rows || [];
          whRows = whRes.rows || [];
          partyRows = partyRes.rows || [];
        }

        if (!expenseRows.length) expenseRows = await getCachedRows("expenses", companyId);
        if (!smRows.length) smRows = await getCachedRows("salesmen", companyId);
        if (!whRows.length) whRows = await getCachedRows("warehouses", companyId);
        if (!partyRows.length) partyRows = await getCachedRows("parties", companyId);

        const sms = smRows.map((s) => ({
          user_id: String(s.id),
          full_name: (s.full_name as string | null) || null,
          phone: (s.phone as string | null) || null,
        }));
        const whs = whRows as unknown as Warehouse[];
        const pts = partyRows as unknown as Party[];
        setSalesmen(sms);
        setWarehouses(whs);
        setVendors(pts.filter((p) => p.party_subtype === "supplier" || p.party_subtype === "both" || p.party_type === "PARTY"));

        const q = (searchParams.get("q") || "").toLowerCase().trim();
        const categoryFilter = searchParams.get("category") || "";
        const salesmanFilter = searchParams.get("salesman") || "";

        const allExpenses: ExpenseRow[] = expenseRows.map((r) => {
          const sm = sms.find((s) => s.user_id === String(r.salesman_id));
          const wh = whs.find((w) => w.id === String(r.warehouse_id));
          const vendor = pts.find((p) => p.id === String(r.vendor_id));
          return {
            id: String(r.id),
            expense_no: String(r.expense_no || r.doc_no || r.id),
            expense_date: String(r.expense_date || r.doc_date || ""),
            category: String(r.category || ""),
            amount: Number(r.amount || 0),
            remarks: r.remarks == null ? null : String(r.remarks),
            salesman_id: r.salesman_id ? String(r.salesman_id) : null,
            salesman_name: sm?.full_name || null,
            warehouse_name: wh?.name || null,
            vendor_name: vendor ? [vendor.party_code, vendor.name_en].filter(Boolean).join(" — ") : null,
          };
        });

        const filtered = allExpenses.filter((e) => {
          if (categoryFilter && e.category !== categoryFilter) return false;
          if (salesmanFilter && e.salesman_id !== salesmanFilter) return false;
          if (q) {
            const text = `${e.expense_no} ${e.category} ${e.remarks || ""} ${e.salesman_name || ""}`.toLowerCase();
            if (!text.includes(q)) return false;
          }
          return true;
        });

        const { paged, pagination } = offlinePaginate(filtered, spRecord);
        setData({ expenses: paged, pagination });
      } catch (err) {
        console.error("Failed to load offline expenses:", err);
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { fetchCompanySalesmen } = await import("@/lib/queries/salesmen");
      const [list, sms, whRes, vendorRes] = await Promise.all([
        fetchExpenseList(supabase, companyId, spRecord),
        fetchCompanySalesmen(supabase, companyId),
        supabase.from("warehouses").select("*").eq("company_id", companyId).eq("is_active", true).order("name"),
        supabase.from("parties").select("*").eq("company_id", companyId).eq("is_active", true)
          .or("party_subtype.in.(supplier,both),party_type.eq.PARTY").order("name_en").limit(500),
      ]);
      setData(list);
      setSalesmen(sms);
      setWarehouses((whRes.data as Warehouse[]) || []);
      setVendors((vendorRes.data as Party[]) || []);
    } catch (err) {
      console.error("Failed to fetch online expenses:", err);
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

  return { ...data, salesmen, warehouses, vendors, loading, refetch: load };
}

// ── Cash vouchers hook (CR / CP / JV) ────────────────────────────────────────

type VoucherKind = "CR" | "CP" | "JV";

const VOUCHER_ENTITY_MAP: Record<VoucherKind, string[]> = {
  CR: ["cash_receipt", "recovery", "CR"],
  CP: ["cash_payment", "payment", "CP"],
  JV: ["journal_voucher", "journal", "JV"],
};

export type VoucherListState = VoucherListResult & {
  parties: Party[];
  loading: boolean;
};

export function useVoucherList({
  companyId,
  kind,
  initialData,
  initialParties = [],
  initialOffline = false,
}: {
  companyId: string;
  kind: VoucherKind;
  initialData?: VoucherListResult | null;
  initialParties?: Party[];
  initialOffline?: boolean;
}): VoucherListState & { refetch: () => Promise<void> } {
  const sync = useSyncStatus();
  const isOnline = sync ? sync.online : !initialOffline;
  const searchParams = useSearchParams();

  const [data, setData] = useState<VoucherListResult>(
    initialData || { vouchers: [], pagination: { page: 1, pageSize: 24, total: 0, totalPages: 1, from: 0, to: 0 } },
  );
  const [parties, setParties] = useState<Party[]>(initialParties);
  const [loading, setLoading] = useState(!initialData);
  const isFirstMount = useRef(true);

  const spRecord = useMemo(() => {
    const rec: Record<string, string | string[] | undefined> = {};
    searchParams.forEach((v, k) => { rec[k] = v; });
    return rec;
  }, [searchParams]);

  const entityTypes = VOUCHER_ENTITY_MAP[kind];

  const load = useCallback(async () => {
    if (!companyId) return;

    if (!isOnline) {
      setLoading(true);
      try {
        const { hasLocalSqlite, localListMaster, localListDocumentsByTypes } = await import(
          "@/lib/offline/sqlite-client"
        );

        let voucherRows: Record<string, unknown>[] = [];
        let partyRows: Record<string, unknown>[] = [];

        if (hasLocalSqlite()) {
          const [vRes, pRes] = await Promise.all([
            localListDocumentsByTypes(companyId, entityTypes),
            localListMaster("parties", companyId),
          ]);
          voucherRows = vRes.rows || [];
          partyRows = pRes.rows || [];
        }

        if (!voucherRows.length) voucherRows = await getCachedRows("vouchers", companyId);
        if (!partyRows.length) partyRows = await getCachedRows("parties", companyId);

        const pts = partyRows as unknown as Party[];
        setParties(pts);

        // Filter by voucher type
        const filtered = voucherRows.filter((r) => {
          const t = String(r.voucher_type || r.type || r.entity_type || "");
          return entityTypes.some((et) => t === et || t.toUpperCase() === kind);
        });

        const q = (searchParams.get("q") || "").toLowerCase().trim();

        const allVouchers: VoucherRow[] = filtered.map((r) => ({
          id: String(r.id),
          voucher_no: String(r.voucher_no || r.doc_no || r.id),
          voucher_date: String(r.voucher_date || r.doc_date || ""),
          total_amount: Number(r.total_amount ?? r.amount ?? r.grand_total ?? 0),
          narration: r.narration == null ? null : String(r.narration),
        }));

        const filteredVouchers = allVouchers.filter((v) => {
          if (!q) return true;
          return `${v.voucher_no} ${v.narration || ""}`.toLowerCase().includes(q);
        });

        const { paged, pagination } = offlinePaginate(filteredVouchers, spRecord);
        setData({ vouchers: paged, pagination });
      } catch (err) {
        console.error(`Failed to load offline vouchers (${kind}):`, err);
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const [{ data: partyData }, list] = await Promise.all([
        supabase.from("parties").select("*").eq("company_id", companyId).eq("is_active", true).order("name_en"),
        fetchVoucherList(supabase, companyId, spRecord, kind),
      ]);
      setParties((partyData as Party[]) || []);
      setData(list);
    } catch (err) {
      console.error(`Failed to fetch online vouchers (${kind}):`, err);
    } finally {
      setLoading(false);
    }
  }, [companyId, isOnline, kind, searchParams, spRecord, entityTypes]);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      if (initialData && isOnline) return;
    }
    void load();
  }, [load, initialData, isOnline]);

  return { ...data, parties, loading, refetch: load };
}

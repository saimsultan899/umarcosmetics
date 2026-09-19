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
import {
  fetchGatePassList,
  type GatePassListRow,
  type GatePassListResult,
} from "@/lib/queries/gate-passes";
import {
  fetchLoadSheetList,
  type LoadSheetRow,
  type LoadSheetListResult,
} from "@/lib/queries/load-sheets";
import {
  fetchStockTransferList,
  type StockTransferRow,
  type StockTransferListResult,
} from "@/lib/queries/stock-transfers";
import { createClient } from "@/lib/supabase/client";
import type { Party, Product, Warehouse } from "@/lib/types/database";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatNumber } from "@/lib/utils";

// ── Shared helpers ───────────────────────────────────────────────────────────

function paginate<T>(
  items: T[],
  paginationParams: { page: number; pageSize: PageSize },
): { paged: T[]; pagination: PaginationMeta } {
  const pagination = buildPaginationMeta(items.length, paginationParams);
  const from = pagination.from ? pagination.from - 1 : 0;
  return { paged: items.slice(from, pagination.to), pagination };
}

function matchesQuery(haystack: string, q: string) {
  return !q || haystack.toLowerCase().includes(q);
}

// ── Gate Passes hook ─────────────────────────────────────────────────────────

export type GatePassesState = GatePassListResult & {
  warehouses: Warehouse[];
  parties: Party[];
  products: Product[];
  loading: boolean;
};

export function useGatePassList({
  companyId,
  initialData,
  initialWarehouses = [],
  initialParties = [],
  initialProducts = [],
  initialOffline = false,
}: {
  companyId: string;
  initialData?: GatePassListResult | null;
  initialWarehouses?: Warehouse[];
  initialParties?: Party[];
  initialProducts?: Product[];
  initialOffline?: boolean;
}): GatePassesState & { refetch: () => Promise<void> } {
  const sync = useSyncStatus();
  const isOnline = sync ? sync.online : !initialOffline;
  const searchParams = useSearchParams();

  const [data, setData] = useState<GatePassListResult>(
    initialData || { rows: [], pagination: { page: 1, pageSize: 24, total: 0, totalPages: 1, from: 0, to: 0 } },
  );
  const [warehouses, setWarehouses] = useState<Warehouse[]>(initialWarehouses);
  const [parties, setParties] = useState<Party[]>(initialParties);
  const [products, setProducts] = useState<Product[]>(initialProducts);
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

        let gateRows: Record<string, unknown>[] = [];
        let whRows: Record<string, unknown>[] = [];
        let partyRows: Record<string, unknown>[] = [];
        let prodRows: Record<string, unknown>[] = [];

        if (hasLocalSqlite()) {
          const [gpRes, whRes, prRes, prodRes] = await Promise.all([
            localListByEntity(companyId, "gate_pass"),
            localListMaster("warehouses", companyId),
            localListMaster("parties", companyId),
            localListMaster("products", companyId),
          ]);
          gateRows = gpRes.rows || [];
          whRows = whRes.rows || [];
          partyRows = prRes.rows || [];
          prodRows = prodRes.rows || [];
        }

        if (!gateRows.length) gateRows = await getCachedRows("gate_passes", companyId);
        if (!whRows.length) whRows = await getCachedRows("warehouses", companyId);
        if (!partyRows.length) partyRows = await getCachedRows("parties", companyId);
        if (!prodRows.length) prodRows = await getCachedRows("products", companyId);

        const whs = whRows as unknown as Warehouse[];
        const pts = partyRows as unknown as Party[];
        const prods = prodRows as unknown as Product[];
        setWarehouses(whs);
        setParties(pts);
        setProducts(prods);

        const q = (searchParams.get("q") || "").toLowerCase().trim();
        const warehouseId = searchParams.get("warehouse") || "";

        const allRows: GatePassListRow[] = gateRows.map((r) => {
          const party = pts.find((p) => p.id === String(r.party_id));
          const wh = whs.find((w) => w.id === String(r.warehouse_id));
          return {
            id: String(r.id),
            pass_no: String(r.pass_no || r.doc_no || r.id),
            pass_date: String(r.pass_date || r.doc_date || ""),
            supplier: party ? `${party.party_code} — ${party.name_en}` : String(r.party_name || "—"),
            warehouse: wh?.name || String(r.warehouse_name || "—"),
            brand: String(r.manufacturer || r.brand || "—"),
            qty: String(r.qty || "—"),
          };
        });

        const filtered = allRows.filter((gp) => {
          if (warehouseId) {
            const wh = whs.find((w) => w.name === gp.warehouse);
            if (!wh || wh.id !== warehouseId) return false;
          }
          return matchesQuery(`${gp.pass_no} ${gp.supplier} ${gp.warehouse} ${gp.brand}`, q);
        });

        const { paged, pagination } = paginate(filtered, parsePaginationParams(spRecord));
        setData({ rows: paged, pagination });
      } catch (err) {
        console.error("Failed to load offline gate passes:", err);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Online
    setLoading(true);
    try {
      const supabase = createClient();
      const [whRes, prRes, prodRes, list] = await Promise.all([
        supabase.from("warehouses").select("*").eq("company_id", companyId).eq("is_active", true).order("name"),
        supabase.from("parties").select("*").eq("company_id", companyId).eq("is_active", true).order("name_en"),
        supabase.from("products").select("*").eq("company_id", companyId).eq("is_active", true).order("code"),
        fetchGatePassList(supabase, companyId, spRecord),
      ]);
      setWarehouses((whRes.data as Warehouse[]) || []);
      setParties((prRes.data as Party[]) || []);
      setProducts((prodRes.data as Product[]) || []);
      setData(list);
    } catch (err) {
      console.error("Failed to fetch online gate passes:", err);
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

  return { ...data, warehouses, parties, products, loading, refetch: load };
}

// ── Load Sheets hook ─────────────────────────────────────────────────────────

export type LoadSheetsState = LoadSheetListResult & {
  warehouses: Warehouse[];
  products: Product[];
  salesmen: Array<{ user_id: string; full_name: string | null; phone?: string | null }>;
  loading: boolean;
};

export function useLoadSheetList({
  companyId,
  initialData,
  initialWarehouses = [],
  initialProducts = [],
  initialSalesmen = [],
  initialOffline = false,
}: {
  companyId: string;
  initialData?: LoadSheetListResult | null;
  initialWarehouses?: Warehouse[];
  initialProducts?: Product[];
  initialSalesmen?: Array<{ user_id: string; full_name: string | null; phone?: string | null }>;
  initialOffline?: boolean;
}): LoadSheetsState & { refetch: () => Promise<void> } {
  const sync = useSyncStatus();
  const isOnline = sync ? sync.online : !initialOffline;
  const searchParams = useSearchParams();

  const [data, setData] = useState<LoadSheetListResult>(
    initialData || { rows: [], pagination: { page: 1, pageSize: 24, total: 0, totalPages: 1, from: 0, to: 0 } },
  );
  const [warehouses, setWarehouses] = useState<Warehouse[]>(initialWarehouses);
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [salesmen, setSalesmen] = useState(initialSalesmen);
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

        let lsRows: Record<string, unknown>[] = [];
        let whRows: Record<string, unknown>[] = [];
        let prodRows: Record<string, unknown>[] = [];
        let smRows: Record<string, unknown>[] = [];

        if (hasLocalSqlite()) {
          const [lsRes, whRes, prodRes, smRes] = await Promise.all([
            localListByEntity(companyId, "load_sheet"),
            localListMaster("warehouses", companyId),
            localListMaster("products", companyId),
            localListMaster("salesmen", companyId),
          ]);
          lsRows = lsRes.rows || [];
          whRows = whRes.rows || [];
          prodRows = prodRes.rows || [];
          smRows = smRes.rows || [];
        }

        if (!lsRows.length) lsRows = await getCachedRows("load_sheets", companyId);
        if (!whRows.length) whRows = await getCachedRows("warehouses", companyId);
        if (!prodRows.length) prodRows = await getCachedRows("products", companyId);
        if (!smRows.length) smRows = await getCachedRows("salesmen", companyId);

        const whs = whRows as unknown as Warehouse[];
        const prods = prodRows as unknown as Product[];
        const sms = smRows.map((s) => ({
          user_id: String(s.id),
          full_name: (s.full_name as string | null) || null,
          phone: (s.phone as string | null) || null,
        }));
        setWarehouses(whs);
        setProducts(prods);
        setSalesmen(sms);

        const q = (searchParams.get("q") || "").toLowerCase().trim();
        const warehouseId = searchParams.get("warehouse") || "";

        const allRows: LoadSheetRow[] = lsRows.map((r) => ({
          id: String(r.id),
          sheet_no: String(r.sheet_no || r.doc_no || r.id),
          sheet_date: String(r.sheet_date || r.doc_date || ""),
          warehouse: String(r.warehouse_name || whs.find((w) => w.id === String(r.warehouse_id))?.name || ""),
          vehicle_route: String(r.vehicle_no || r.route || ""),
          qty: String(r.qty || "—"),
          status: String(r.status || "posted"),
        }));

        const filtered = allRows.filter((ls) => {
          if (warehouseId) {
            const wh = whs.find((w) => w.name === ls.warehouse);
            if (!wh || wh.id !== warehouseId) return false;
          }
          return matchesQuery(`${ls.sheet_no} ${ls.warehouse} ${ls.vehicle_route}`, q);
        });

        const { paged, pagination } = paginate(filtered, parsePaginationParams(spRecord));
        setData({ rows: paged, pagination });
      } catch (err) {
        console.error("Failed to load offline load sheets:", err);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Online
    setLoading(true);
    try {
      const supabase = createClient();
      const { fetchCompanySalesmen } = await import("@/lib/queries/salesmen");
      const [whRes, prodRes, sms, list] = await Promise.all([
        supabase.from("warehouses").select("*").eq("company_id", companyId).eq("is_active", true).order("name"),
        supabase.from("products").select("*").eq("company_id", companyId).eq("is_active", true).order("code"),
        fetchCompanySalesmen(supabase, companyId),
        fetchLoadSheetList(supabase, companyId, spRecord),
      ]);
      setWarehouses((whRes.data as Warehouse[]) || []);
      setProducts((prodRes.data as Product[]) || []);
      setSalesmen(sms);
      setData(list);
    } catch (err) {
      console.error("Failed to fetch online load sheets:", err);
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

  return { ...data, warehouses, products, salesmen, loading, refetch: load };
}

// ── Stock Transfers hook ─────────────────────────────────────────────────────

export type StockTransfersState = StockTransferListResult & {
  warehouses: Warehouse[];
  products: Product[];
  loading: boolean;
};

export function useStockTransferList({
  companyId,
  initialData,
  initialWarehouses = [],
  initialProducts = [],
  initialOffline = false,
}: {
  companyId: string;
  initialData?: StockTransferListResult | null;
  initialWarehouses?: Warehouse[];
  initialProducts?: Product[];
  initialOffline?: boolean;
}): StockTransfersState & { refetch: () => Promise<void> } {
  const sync = useSyncStatus();
  const isOnline = sync ? sync.online : !initialOffline;
  const searchParams = useSearchParams();

  const [data, setData] = useState<StockTransferListResult>(
    initialData || { rows: [], pagination: { page: 1, pageSize: 24, total: 0, totalPages: 1, from: 0, to: 0 } },
  );
  const [warehouses, setWarehouses] = useState<Warehouse[]>(initialWarehouses);
  const [products, setProducts] = useState<Product[]>(initialProducts);
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

        let trRows: Record<string, unknown>[] = [];
        let whRows: Record<string, unknown>[] = [];
        let prodRows: Record<string, unknown>[] = [];

        if (hasLocalSqlite()) {
          const [trRes, whRes, prodRes] = await Promise.all([
            localListByEntity(companyId, "stock_transfer"),
            localListMaster("warehouses", companyId),
            localListMaster("products", companyId),
          ]);
          trRows = trRes.rows || [];
          whRows = whRes.rows || [];
          prodRows = prodRes.rows || [];
        }

        if (!trRows.length) trRows = await getCachedRows("stock_transfers", companyId);
        if (!whRows.length) whRows = await getCachedRows("warehouses", companyId);
        if (!prodRows.length) prodRows = await getCachedRows("products", companyId);

        const whs = whRows as unknown as Warehouse[];
        const prods = prodRows as unknown as Product[];
        setWarehouses(whs);
        setProducts(prods);

        const q = (searchParams.get("q") || "").toLowerCase().trim();
        const fromId = searchParams.get("from") || "";
        const toId = searchParams.get("to") || "";

        const allRows: StockTransferRow[] = trRows.map((r) => ({
          id: String(r.id),
          transfer_no: String(r.transfer_no || r.doc_no || r.id),
          transfer_date: String(r.transfer_date || r.doc_date || ""),
          from_name: String(r.from_name || r.from_warehouse_name || whs.find((w) => w.id === String(r.from_warehouse_id))?.name || ""),
          to_name: String(r.to_name || r.to_warehouse_name || whs.find((w) => w.id === String(r.to_warehouse_id))?.name || ""),
        }));

        const filtered = allRows.filter((tr) => {
          if (fromId) {
            const wh = whs.find((w) => w.name === tr.from_name);
            if (!wh || wh.id !== fromId) return false;
          }
          if (toId) {
            const wh = whs.find((w) => w.name === tr.to_name);
            if (!wh || wh.id !== toId) return false;
          }
          return matchesQuery(`${tr.transfer_no} ${tr.from_name} ${tr.to_name}`, q);
        });

        const { paged, pagination } = paginate(filtered, parsePaginationParams(spRecord));
        setData({ rows: paged, pagination });
      } catch (err) {
        console.error("Failed to load offline stock transfers:", err);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Online
    setLoading(true);
    try {
      const supabase = createClient();
      const [whRes, prodRes, list] = await Promise.all([
        supabase.from("warehouses").select("*").eq("company_id", companyId).eq("is_active", true).order("name"),
        supabase.from("products").select("*").eq("company_id", companyId).eq("is_active", true).order("code"),
        fetchStockTransferList(supabase, companyId, spRecord),
      ]);
      setWarehouses((whRes.data as Warehouse[]) || []);
      setProducts((prodRes.data as Product[]) || []);
      setData(list);
    } catch (err) {
      console.error("Failed to fetch online stock transfers:", err);
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

  return { ...data, warehouses, products, loading, refetch: load };
}

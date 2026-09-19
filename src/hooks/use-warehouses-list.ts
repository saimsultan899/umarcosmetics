"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import type { WarehouseListStats } from "@/components/tables/warehouses-list";
import { getCachedRows } from "@/lib/offline/local-db";
import { offlineStockSnapshot } from "@/lib/offline/offline-reports";
import { createClient } from "@/lib/supabase/client";
import type { Product, Warehouse } from "@/lib/types/database";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type WarehousesListState = {
  warehouses: Warehouse[];
  statsByWarehouse: Record<string, WarehouseListStats>;
  loading: boolean;
  totalCompanies: number;
  totalManagedProducts: number;
  totalInStockSkus: number;
  totalStockValuation: number;
};

export function useWarehousesList({
  companyId,
  initialWarehouses = [],
  initialStats = {},
  initialOffline = false,
}: {
  companyId: string;
  initialWarehouses?: Warehouse[];
  initialStats?: Record<string, WarehouseListStats>;
  initialOffline?: boolean;
}): WarehousesListState & { refetch: () => Promise<void> } {
  const sync = useSyncStatus();
  const isOnline = sync ? sync.online : !initialOffline;

  const [warehouses, setWarehouses] = useState<Warehouse[]>(initialWarehouses);
  const [statsByWarehouse, setStatsByWarehouse] =
    useState<Record<string, WarehouseListStats>>(initialStats);
  const [loading, setLoading] = useState(!initialWarehouses.length);
  const isFirstMount = useRef(true);

  const load = useCallback(async () => {
    if (!companyId) return;

    if (!isOnline) {
      setLoading(true);
      try {
        const { hasLocalSqlite, localListMaster } = await import(
          "@/lib/offline/sqlite-client"
        );

        let whRows: Record<string, unknown>[] = [];
        let prodRows: Record<string, unknown>[] = [];

        if (hasLocalSqlite()) {
          const [whRes, prodRes] = await Promise.all([
            localListMaster("warehouses", companyId),
            localListMaster("products", companyId),
          ]);
          whRows = whRes.rows || [];
          prodRows = prodRes.rows || [];
        }

        if (!whRows.length) whRows = await getCachedRows("warehouses", companyId);
        if (!prodRows.length) prodRows = await getCachedRows("products", companyId);

        const stockRows = await offlineStockSnapshot(companyId);

        const activeWarehouses = (whRows as unknown as Warehouse[])
          .filter((w) => w.is_active !== false)
          .sort((a, b) => a.name.localeCompare(b.name));

        const activeProducts = (prodRows as unknown as Product[]).filter(
          (p) => p.is_active !== false,
        );

        const purchaseByProduct = new Map<string, number>();
        const assignedWhByProduct = new Map<string, string>();
        const productCountByWh = new Map<string, number>();

        for (const p of activeProducts) {
          if (!p.default_warehouse_id) continue;
          purchaseByProduct.set(p.id, Number(p.purchase_rate || 0));
          assignedWhByProduct.set(p.id, p.default_warehouse_id);
          productCountByWh.set(
            p.default_warehouse_id,
            (productCountByWh.get(p.default_warehouse_id) || 0) + 1,
          );
        }

        const inStockByWh = new Map<string, Set<string>>();
        const valueByWh = new Map<string, number>();

        for (const row of stockRows) {
          const qty = Number(row.qty || 0);
          if (!(qty > 0)) continue;
          const pid = String(row.product_id);
          const wid = String(row.warehouse_id);

          // Count stock only for products assigned to this company
          if (assignedWhByProduct.get(pid) !== wid) continue;

          const set = inStockByWh.get(wid) || new Set<string>();
          set.add(pid);
          inStockByWh.set(wid, set);

          const rate = purchaseByProduct.get(pid) || 0;
          valueByWh.set(wid, (valueByWh.get(wid) || 0) + qty * rate);
        }

        const stats: Record<string, WarehouseListStats> = {};
        for (const w of activeWarehouses) {
          stats[w.id] = {
            warehouseId: w.id,
            productCount: productCountByWh.get(w.id) || 0,
            inStockCount: inStockByWh.get(w.id)?.size || 0,
            stockValue: valueByWh.get(w.id) || 0,
          };
        }

        setWarehouses(activeWarehouses);
        setStatsByWarehouse(stats);
      } catch (err) {
        console.error("Failed to load offline warehouses list:", err);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Online fetch
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: whData } = await supabase
        .from("warehouses")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name");

      const activeWarehouses = (whData as Warehouse[]) || [];
      const warehouseIds = activeWarehouses.map((w) => w.id);

      const [{ data: productRows }, { data: balanceRows }] =
        warehouseIds.length
          ? await Promise.all([
              supabase
                .from("products")
                .select("id, default_warehouse_id, purchase_rate")
                .eq("company_id", companyId)
                .eq("is_active", true)
                .in("default_warehouse_id", warehouseIds),
              supabase
                .from("stock_balances")
                .select("warehouse_id, product_id, qty")
                .in("warehouse_id", warehouseIds),
            ])
          : [{ data: [] }, { data: [] }];

      const purchaseByProduct = new Map<string, number>();
      const assignedWhByProduct = new Map<string, string>();
      const productCountByWh = new Map<string, number>();

      for (const p of productRows || []) {
        if (!p.default_warehouse_id) continue;
        purchaseByProduct.set(p.id, Number(p.purchase_rate || 0));
        assignedWhByProduct.set(p.id, p.default_warehouse_id);
        productCountByWh.set(
          p.default_warehouse_id,
          (productCountByWh.get(p.default_warehouse_id) || 0) + 1,
        );
      }

      const inStockByWh = new Map<string, Set<string>>();
      const valueByWh = new Map<string, number>();

      for (const row of balanceRows || []) {
        const qty = Number(row.qty || 0);
        if (!(qty > 0)) continue;
        if (assignedWhByProduct.get(row.product_id) !== row.warehouse_id) continue;
        const set = inStockByWh.get(row.warehouse_id) || new Set<string>();
        set.add(row.product_id);
        inStockByWh.set(row.warehouse_id, set);
        const rate = purchaseByProduct.get(row.product_id) || 0;
        valueByWh.set(
          row.warehouse_id,
          (valueByWh.get(row.warehouse_id) || 0) + qty * rate,
        );
      }

      const stats: Record<string, WarehouseListStats> = {};
      for (const w of activeWarehouses) {
        stats[w.id] = {
          warehouseId: w.id,
          productCount: productCountByWh.get(w.id) || 0,
          inStockCount: inStockByWh.get(w.id)?.size || 0,
          stockValue: valueByWh.get(w.id) || 0,
        };
      }

      setWarehouses(activeWarehouses);
      setStatsByWarehouse(stats);
    } catch (err) {
      console.error("Failed to load online warehouses list:", err);
    } finally {
      setLoading(false);
    }
  }, [companyId, isOnline]);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      if (initialWarehouses.length && isOnline) return;
    }
    void load();
  }, [load, initialWarehouses.length, isOnline]);

  const summary = useMemo(() => {
    let totalManagedProducts = 0;
    let totalInStockSkus = 0;
    let totalStockValuation = 0;

    for (const stats of Object.values(statsByWarehouse)) {
      totalManagedProducts += stats.productCount || 0;
      totalInStockSkus += stats.inStockCount || 0;
      totalStockValuation += stats.stockValue || 0;
    }

    return {
      totalCompanies: warehouses.length,
      totalManagedProducts,
      totalInStockSkus,
      totalStockValuation,
    };
  }, [warehouses, statsByWarehouse]);

  return {
    warehouses,
    statsByWarehouse,
    loading,
    ...summary,
    refetch: load,
  };
}

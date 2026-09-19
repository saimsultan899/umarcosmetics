"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import { getCachedRows } from "@/lib/offline/local-db";
import { offlineStockSnapshot } from "@/lib/offline/offline-reports";
import { createClient } from "@/lib/supabase/client";
import type { Product, Warehouse } from "@/lib/types/database";
import { useEffect, useMemo, useState } from "react";

export type WarehouseProductRow = Product & { qty: number };

export type WarehouseDetailState = {
  warehouse: Warehouse | null;
  rows: WarehouseProductRow[];
  totalSkus: number;
  inStock: number;
  stockValue: number;
  loading: boolean;
};

export function useWarehouseDetail({
  companyId,
  warehouseId,
  initialWarehouse,
  initialRows,
  initialOffline = false,
}: {
  companyId: string;
  warehouseId: string;
  initialWarehouse?: Warehouse | null;
  initialRows?: WarehouseProductRow[];
  initialOffline?: boolean;
}): WarehouseDetailState {
  const sync = useSyncStatus();
  const isOnline = sync ? sync.online : !initialOffline;

  const [warehouse, setWarehouse] = useState<Warehouse | null>(initialWarehouse || null);
  const [rows, setRows] = useState<WarehouseProductRow[]>(initialRows || []);
  const [loading, setLoading] = useState(!initialWarehouse);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isOnline) {
        // Offline: read from local SQLite / IndexedDB
        try {
          const { hasLocalSqlite, localListMaster } = await import("@/lib/offline/sqlite-client");

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

          if (cancelled) return;

          const foundWh = whRows.find((w) => String(w.id) === warehouseId) as unknown as Warehouse | undefined;
          if (foundWh) setWarehouse(foundWh);

          const stockMap = new Map<string, number>();
          for (const s of stockRows) {
            if (String(s.warehouse_id) === warehouseId) {
              stockMap.set(String(s.product_id), Number(s.qty || 0));
            }
          }

          const assigned = prodRows
            .filter((p) => String(p.default_warehouse_id) === warehouseId)
            .map((p) => ({
              ...(p as unknown as Product),
              qty: stockMap.get(String(p.id)) || 0,
            }));

          setRows(assigned);
        } catch (err) {
          console.error("Failed to load offline warehouse detail:", err);
        } finally {
          if (!cancelled) setLoading(false);
        }
        return;
      }

      // Online: if initial props were not provided, fetch from Supabase
      if (!initialWarehouse || !initialRows) {
        try {
          const supabase = createClient();
          const { data: wh } = await supabase
            .from("warehouses")
            .select("*")
            .eq("company_id", companyId)
            .eq("id", warehouseId)
            .maybeSingle();

          if (cancelled) return;
          if (wh) setWarehouse(wh as Warehouse);

          const [{ data: prods }, { data: balances }] = await Promise.all([
            supabase
              .from("products")
              .select(
                "id, code, name_en, product_type, retail_rate, purchase_rate, packing, unit_type, base_unit, reorder_level, is_active",
              )
              .eq("company_id", companyId)
              .eq("is_active", true)
              .eq("default_warehouse_id", warehouseId)
              .order("code"),
            supabase
              .from("stock_balances")
              .select("product_id, qty")
              .eq("warehouse_id", warehouseId),
          ]);

          if (cancelled) return;

          const qtyByProd = new Map<string, number>();
          for (const b of balances || []) {
            qtyByProd.set(b.product_id, Number(b.qty || 0));
          }

          const assigned = ((prods || []) as Product[]).map((p) => ({
            ...p,
            qty: qtyByProd.get(p.id) || 0,
          }));

          setRows(assigned);
        } catch (err) {
          console.error("Failed to load online warehouse detail:", err);
        } finally {
          if (!cancelled) setLoading(false);
        }
      } else {
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [companyId, warehouseId, isOnline, initialWarehouse, initialRows]);

  const totalSkus = rows.length;
  const inStock = useMemo(() => rows.filter((r) => r.qty > 0).length, [rows]);
  const stockValue = useMemo(() => {
    return rows.reduce(
      (sum, r) => sum + r.qty * Number(r.purchase_rate || 0),
      0,
    );
  }, [rows]);

  return {
    warehouse,
    rows,
    totalSkus,
    inStock,
    stockValue,
    loading,
  };
}

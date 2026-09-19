"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import { getCachedRows } from "@/lib/offline/local-db";
import {
  buildPaginationMeta,
  parsePaginationParams,
} from "@/lib/pagination";
import {
  fetchProductList,
  type ProductListResult,
  type ProductListStats,
} from "@/lib/queries/products";
import { createClient } from "@/lib/supabase/client";
import type { Product, Warehouse } from "@/lib/types/database";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function useProductsList({
  companyId,
  initialData,
  initialWarehouses,
  initialOffline = false,
}: {
  companyId: string;
  initialData?: ProductListResult | null;
  initialWarehouses?: Warehouse[];
  initialOffline?: boolean;
}) {
  const sync = useSyncStatus();
  const isOnline = sync ? sync.online : !initialOffline;
  const searchParams = useSearchParams();

  const [data, setData] = useState<ProductListResult | null>(initialData || null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>(initialWarehouses || []);
  const [loading, setLoading] = useState<boolean>(!initialData);
  const isFirstMount = useRef(true);

  // Convert searchParams to Record
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
        const { offlineStockSnapshot } = await import(
          "@/lib/offline/offline-reports"
        );

        let productRows: Record<string, unknown>[] = [];
        let warehouseRows: Record<string, unknown>[] = [];

        if (hasLocalSqlite()) {
          const [prodRes, whRes] = await Promise.all([
            localListMaster("products", companyId),
            localListMaster("warehouses", companyId),
          ]);
          productRows = prodRes.rows || [];
          warehouseRows = whRes.rows || [];
        }

        if (!productRows.length)
          productRows = await getCachedRows("products", companyId);
        if (!warehouseRows.length)
          warehouseRows = await getCachedRows("warehouses", companyId);

        const stockBalances = await offlineStockSnapshot(companyId);

        const qtyByProduct = new Map<string, number>();
        for (const b of stockBalances) {
          const pid = String(b.product_id || "");
          qtyByProduct.set(pid, (qtyByProduct.get(pid) || 0) + Number(b.qty || 0));
        }

        const allProducts = (productRows as unknown as Product[]).filter(
          (p) => p.is_active !== false && (p as Record<string, unknown>).is_active !== 0,
        );

        const allWarehouses = warehouseRows as unknown as Warehouse[];
        setWarehouses(allWarehouses);

        const q = (searchParams.get("q") || "").toLowerCase().trim();
        const view = searchParams.get("view") || "all";
        const warehouseId = searchParams.get("warehouse") || "";
        const paginationParams = parsePaginationParams(spRecord);

        // Stock value by product code
        const stockValueByCode: Record<string, number> = {};
        const lowStockCodes: string[] = [];

        for (const p of allProducts) {
          const qty = qtyByProduct.get(p.id) || 0;
          const rate = Number(p.purchase_rate || p.retail_rate || 0);
          const val = qty * rate;
          stockValueByCode[p.code] = val;
          if (Number(p.reorder_level || 0) > 0 && qty <= Number(p.reorder_level)) {
            lowStockCodes.push(p.code);
          }
        }

        // Filter
        const filtered = allProducts.filter((p) => {
          if (view === "reorder" && Number(p.reorder_level || 0) <= 0) return false;
          if (warehouseId && p.default_warehouse_id !== warehouseId) return false;
          if (q) {
            const text = `${p.code || ""} ${p.name_en || ""} ${p.name_ur || ""} ${p.barcode || ""} ${p.product_type || ""} ${p.manufacturer || ""} ${p.category_group || ""}`.toLowerCase();
            if (!text.includes(q)) return false;
          }
          return true;
        });

        const lowSet = new Set(lowStockCodes);
        const lowCount = filtered.filter((p) => lowSet.has(p.code)).length;

        const warehouseMap = new Map(allWarehouses.map((w) => [w.id, w.name]));
        const makerCounts = new Map<string, number>();
        for (const p of filtered) {
          const key = warehouseMap.get(p.default_warehouse_id || "") || "Unassigned";
          makerCounts.set(key, (makerCounts.get(key) || 0) + 1);
        }

        const totalStockVal = filtered.reduce(
          (s, p) => s + Number(stockValueByCode[p.code] || 0),
          0,
        );

        const topStock = filtered
          .map((p) => ({
            name: `${p.code} — ${p.name_en}`,
            value: Number(stockValueByCode[p.code] || 0),
          }))
          .filter((x) => x.value > 0)
          .sort((a, b) => b.value - a.value)
          .slice(0, 5);

        const health = [
          { name: "Healthy", value: Math.max(filtered.length - lowCount, 0) },
          { name: "Low stock", value: lowCount },
        ].filter((x) => x.value > 0);

        const stats: ProductListStats = {
          total: filtered.length,
          stockValue: totalStockVal,
          withReorder: filtered.filter((p) => Number(p.reorder_level || 0) > 0).length,
          lowStock: lowStockCodes.length,
          makerBars: [...makerCounts.entries()]
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 6),
          topStock,
          health,
        };

        const pagination = buildPaginationMeta(filtered.length, paginationParams);
        const from = pagination.from ? pagination.from - 1 : 0;
        const paged = filtered.slice(from, pagination.to);

        setData({ products: paged, pagination, stats, stockValueByCode, lowStockCodes });
      } catch (err) {
        console.error("Failed to load offline products list:", err);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Online
    try {
      setLoading(true);
      const supabase = createClient();
      const [whRes, listRes] = await Promise.all([
        supabase
          .from("warehouses")
          .select("*")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .order("name"),
        fetchProductList(supabase, companyId, spRecord),
      ]);
      setWarehouses((whRes.data as Warehouse[]) || []);
      setData(listRes);
    } catch (err) {
      console.error("Failed to fetch online products list:", err);
    } finally {
      setLoading(false);
    }
  }, [companyId, isOnline, searchParams, spRecord]);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      if (initialData && isOnline) return;
    }
    void loadData();
  }, [loadData, initialData, isOnline]);

  return { data, warehouses, loading, refetch: loadData };
}

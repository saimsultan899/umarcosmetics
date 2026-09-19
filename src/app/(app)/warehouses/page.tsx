import { WarehousesView } from "@/components/warehouses/warehouses-view";
import type { WarehouseListStats } from "@/components/tables/warehouses-list";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { requireCompanyContext } from "@/lib/auth";
import type { Warehouse } from "@/lib/types/database";
import { Suspense } from "react";

export default async function WarehousesPage() {
  const ctx = await requireCompanyContext();
  const { supabase, company, offline } = ctx;

  let initialWarehouses: Warehouse[] = [];
  let initialStats: Record<string, WarehouseListStats> = {};

  if (!offline) {
    try {
      const { data: warehouses } = await supabase
        .from("warehouses")
        .select("*")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("name");

      initialWarehouses = (warehouses as Warehouse[]) || [];
      const warehouseIds = initialWarehouses.map((w) => w.id);

      const [{ data: productRows }, { data: balanceRows }] =
        warehouseIds.length
          ? await Promise.all([
              supabase
                .from("products")
                .select("id, default_warehouse_id, purchase_rate")
                .eq("company_id", company.id)
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

      for (const w of initialWarehouses) {
        initialStats[w.id] = {
          warehouseId: w.id,
          productCount: productCountByWh.get(w.id) || 0,
          inStockCount: inStockByWh.get(w.id)?.size || 0,
          stockValue: valueByWh.get(w.id) || 0,
        };
      }
    } catch (err) {
      console.error("Failed to load initial warehouses data:", err);
    }
  }

  return (
    <Suspense fallback={<PageSkeleton />}>
      <WarehousesView
        company={company}
        initialWarehouses={initialWarehouses}
        initialStats={initialStats}
        initialOffline={offline}
      />
    </Suspense>
  );
}

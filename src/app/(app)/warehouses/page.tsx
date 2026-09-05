import { WarehouseForm } from "@/components/forms/warehouse-form";
import {
  WarehousesList,
  type WarehouseListStats,
} from "@/components/tables/warehouses-list";
import { Button } from "@/components/ui/button";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { requireCompanyContext } from "@/lib/auth";
import type { Warehouse } from "@/lib/types/database";
import Link from "next/link";

export default async function WarehousesPage() {
  const { supabase, company } = await requireCompanyContext();
  const { data: warehouses } = await supabase
    .from("warehouses")
    .select("*")
    .eq("company_id", company.id)
    .eq("is_active", true)
    .order("name");

  const warehouseIds = (warehouses || []).map((w) => w.id);

  const [{ data: productRows }, { data: balanceRows }] = warehouseIds.length
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
    // Count stock only for products assigned to this company
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

  const statsByWarehouse: Record<string, WarehouseListStats> = {};
  for (const w of warehouses || []) {
    statsByWarehouse[w.id] = {
      warehouseId: w.id,
      productCount: productCountByWh.get(w.id) || 0,
      inStockCount: inStockByWh.get(w.id)?.size || 0,
      stockValue: valueByWh.get(w.id) || 0,
    };
  }

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Companies"
        description="Brand / stock companies — open one to see its products and stock."
        actions={
          <>
            <Link href="/inventory/expiry">
              <Button variant="secondary" size="sm">
                Expiry warehouse
              </Button>
            </Link>
            <Link href="/warehouses/transfers">
              <Button variant="secondary" size="sm">
                Stock transfer
              </Button>
            </Link>
            <CreateDialogButton
              label="Add company"
              title="Add company"
              description="Create a stock company or brand location"
            >
              <WarehouseForm
                companyId={company.id}
                organizationId={company.organization_id}
              />
            </CreateDialogButton>
          </>
        }
      />

      <WarehousesList
        warehouses={(warehouses as Warehouse[]) || []}
        companyId={company.id}
        organizationId={company.organization_id}
        statsByWarehouse={statsByWarehouse}
      />
    </div>
  );
}

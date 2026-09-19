import { WarehouseDetailView } from "@/components/warehouses/warehouse-detail-view";
import { requireCompanyContext } from "@/lib/auth";
import type { WarehouseProductRow } from "@/hooks/use-warehouse-detail";
import { notFound } from "next/navigation";

export default async function WarehouseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, company, offline } = await requireCompanyContext();

  if (offline) {
    return (
      <WarehouseDetailView
        companyId={company.id}
        organizationId={company.organization_id}
        warehouseId={id}
        initialOffline={true}
      />
    );
  }

  const { data: warehouse } = await supabase
    .from("warehouses")
    .select("*")
    .eq("company_id", company.id)
    .eq("id", id)
    .maybeSingle();

  if (!warehouse) notFound();

  const [{ data: products }, { data: balances }] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id, code, name_en, product_type, retail_rate, purchase_rate, packing, unit_type, base_unit, reorder_level, is_active",
      )
      .eq("company_id", company.id)
      .eq("is_active", true)
      .eq("default_warehouse_id", id)
      .order("code"),
    supabase
      .from("stock_balances")
      .select("product_id, qty")
      .eq("warehouse_id", id),
  ]);

  const qtyByProduct = new Map<string, number>();
  for (const row of balances || []) {
    qtyByProduct.set(row.product_id, Number(row.qty || 0));
  }

  const rows: WarehouseProductRow[] = (products || []).map((p) => {
    const qty = qtyByProduct.get(p.id) || 0;
    return { ...p, qty } as WarehouseProductRow;
  });

  return (
    <WarehouseDetailView
      companyId={company.id}
      organizationId={company.organization_id}
      warehouseId={id}
      initialWarehouse={warehouse}
      initialRows={rows}
      initialOffline={false}
    />
  );
}

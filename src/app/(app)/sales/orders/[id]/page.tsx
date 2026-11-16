import { SaleOrderDetailView } from "@/components/sales/sale-order-detail";
import { requireCompanyContext } from "@/lib/auth";
import { mapSaleOrder, SALE_ORDER_SELECT, type SaleOrderQueryRow } from "@/lib/sales/sale-orders";
import { notFound } from "next/navigation";

export default async function SalesmanOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, company, offline, membership, profile } = await requireCompanyContext();
  if (offline) {
    return (
      <div className="rounded-[var(--radius)] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Salesman orders need a connection.
      </div>
    );
  }

  const { data } = await supabase
    .from("sale_orders")
    .select(SALE_ORDER_SELECT)
    .eq("company_id", company.id)
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();
  const order = mapSaleOrder(data as unknown as SaleOrderQueryRow);
  const canManage =
    profile?.is_super_admin === true ||
    ["super_admin", "org_admin", "company_admin", "accountant", "inventory", "sales_desk"].includes(
      membership?.role || "",
    );

  return <SaleOrderDetailView order={order} canManage={canManage} />;
}

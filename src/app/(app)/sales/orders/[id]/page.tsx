import { SaleOrderDetailView } from "@/components/sales/sale-order-detail";
import { requireCompanyContext } from "@/lib/auth";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
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

  const [{ data }, parties, products] = await Promise.all([
    supabase
      .from("sale_orders")
      .select(SALE_ORDER_SELECT)
      .eq("company_id", company.id)
      .eq("id", id)
      .maybeSingle(),
    fetchAllPages<{ id: string; party_code: string; name_en: string }>((from, to) =>
      supabase
        .from("parties")
        .select("id, party_code, name_en")
        .eq("company_id", company.id)
        .eq("party_type", "PARTY")
        .in("party_subtype", ["customer", "both"])
        .eq("is_active", true)
        .order("party_code")
        .range(from, to),
    ).catch(() => [] as Array<{ id: string; party_code: string; name_en: string }>),
    fetchAllPages<{
      id: string;
      code: string | null;
      name_en: string;
      sale_rate: number | null;
      retail_rate: number | null;
      default_warehouse_id: string | null;
    }>((from, to) =>
      supabase
        .from("products")
        .select("id, code, name_en, sale_rate, retail_rate, default_warehouse_id")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("name_en")
        .range(from, to),
    ).catch(
      () =>
        [] as Array<{
          id: string;
          code: string | null;
          name_en: string;
          sale_rate: number | null;
          retail_rate: number | null;
          default_warehouse_id: string | null;
        }>,
    ),
  ]);

  if (!data) notFound();
  const order = mapSaleOrder(data as unknown as SaleOrderQueryRow);
  const canManage =
    profile?.is_super_admin === true ||
    ["super_admin", "org_admin", "company_admin", "accountant", "inventory", "sales_desk"].includes(
      membership?.role || "",
    );

  return (
    <SaleOrderDetailView
      order={order}
      canManage={canManage}
      parties={parties}
      products={products}
    />
  );
}

import { SaleOrdersTable } from "@/components/sales/sale-orders-table";
import { PageHeading } from "@/components/ui/create-dialog";
import { requireCompanyContext } from "@/lib/auth";
import { fetchSaleOrderList } from "@/lib/queries/sale-order-list";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";

export default async function SalesmanOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, company, offline } = await requireCompanyContext();

  if (offline) {
    return (
      <div className="rounded-[var(--radius)] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Salesman orders need a connection.
      </div>
    );
  }

  const [{ data: salesmen }, list, parties, products] = await Promise.all([
    supabase
      .from("salesmen")
      .select("id, full_name")
      .eq("company_id", company.id)
      .eq("is_active", true)
      .order("full_name"),
    fetchSaleOrderList(supabase, company.id, sp),
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

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Salesman orders"
        description="Each company on an order is a separate credit bill. View, edit waiting lines, or fulfil one company at a time."
      />
      <SaleOrdersTable
        rows={list.rows}
        pagination={list.pagination}
        summary={list.summary}
        salesmen={salesmen || []}
        parties={parties}
        products={products}
      />
    </div>
  );
}

import { SaleOrdersTable } from "@/components/sales/sale-orders-table";
import { PageHeading } from "@/components/ui/create-dialog";
import { requireCompanyContext } from "@/lib/auth";
import { fetchSaleOrderList } from "@/lib/queries/sale-order-list";

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

  const [{ data: salesmen }, list] = await Promise.all([
    supabase
      .from("salesmen")
      .select("id, full_name")
      .eq("company_id", company.id)
      .eq("is_active", true)
      .order("full_name"),
    fetchSaleOrderList(supabase, company.id, sp),
  ]);

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Salesman orders"
        description="One customer order is one bill. View the lines, then fulfil the order."
      />
      <SaleOrdersTable
        rows={list.rows}
        pagination={list.pagination}
        summary={list.summary}
        salesmen={salesmen || []}
      />
    </div>
  );
}

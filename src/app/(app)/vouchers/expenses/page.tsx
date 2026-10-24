import { ExpensesView } from "@/components/vouchers/expenses-view";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { requireCompanyContext } from "@/lib/auth";
import { fetchExpenseList, type ExpenseListResult } from "@/lib/queries/expenses";
import { fetchCompanySalesmen, type SalesmanOption } from "@/lib/queries/salesmen";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import type { Party, Warehouse } from "@/lib/types/database";
import { Suspense } from "react";

const VENDOR_COLUMNS =
  "id, party_code, name_en, name_ur, party_subtype, party_type, is_active, route, city";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, company, offline } = await requireCompanyContext();

  let initialData: ExpenseListResult | null = null;
  let initialSalesmen: SalesmanOption[] = [];
  let initialWarehouses: Warehouse[] = [];
  let initialVendors: Party[] = [];

  if (!offline) {
    try {
      const [list, salesmen, warehouses, vendors] = await Promise.all([
        fetchExpenseList(supabase, company.id, sp),
        fetchCompanySalesmen(supabase, company.id),
        supabase.from("warehouses").select("*").eq("company_id", company.id).eq("is_active", true).order("name"),
        fetchAllPages<Party>((from, to) =>
          supabase
            .from("parties")
            .select(VENDOR_COLUMNS)
            .eq("company_id", company.id)
            .eq("is_active", true)
            .or("party_subtype.in.(supplier,both),party_type.eq.PARTY")
            .order("name_en", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        ),
      ]);
      initialData = list;
      initialSalesmen = salesmen;
      initialWarehouses = (warehouses.data as Warehouse[]) || [];
      initialVendors = vendors;
    } catch {
      initialData = null;
    }
  }

  return (
    <Suspense fallback={<PageSkeleton />}>
      <ExpensesView
        company={company}
        initialData={initialData}
        initialSalesmen={initialSalesmen}
        initialWarehouses={initialWarehouses}
        initialVendors={initialVendors}
        initialOffline={offline}
      />
    </Suspense>
  );
}

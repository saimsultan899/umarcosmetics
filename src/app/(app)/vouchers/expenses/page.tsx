import { ExpensesTable } from "@/components/tables/expenses-table";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { ExpenseForm } from "@/components/vouchers/expense-form";
import { requireCompanyContext } from "@/lib/auth";
import { fetchExpenseList } from "@/lib/queries/expenses";
import { fetchCompanySalesmen } from "@/lib/queries/salesmen";
import Link from "next/link";
import { Suspense } from "react";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();

  const [list, salesmen, warehouses, vendors] = await Promise.all([
    fetchExpenseList(supabase, company.id, sp),
    fetchCompanySalesmen(supabase, company.id),
    supabase
      .from("warehouses")
      .select("*")
      .eq("company_id", company.id)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("parties")
      .select("*")
      .eq("company_id", company.id)
      .eq("is_active", true)
      .or("party_subtype.in.(supplier,both),party_type.eq.PARTY")
      .order("name_en")
      .limit(500),
  ]);

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Daily expenses & salary"
        description="Record salesman salary and daily costs — fuel, food, rent, builty, bills. Each entry posts to the expense ledger."
        actions={
          <>
            <Link
              href="/reports/expenses"
              className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)]"
            >
              Expense report
            </Link>
            <CreateDialogButton
              label="Add expense"
              title="Daily expenses & salary"
              description="Post one or more costs for the day"
              size="xl"
            >
              <ExpenseForm
                companyId={company.id}
                organizationId={company.organization_id}
                salesmen={salesmen}
                warehouses={warehouses.data || []}
                vendors={vendors.data || []}
              />
            </CreateDialogButton>
          </>
        }
      />

      <Suspense fallback={<PageSkeleton />}>
        <ExpensesTable expenses={list.expenses} pagination={list.pagination} />
      </Suspense>
    </div>
  );
}

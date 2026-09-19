"use client";

import { ExpensesTable } from "@/components/tables/expenses-table";
import { CreateDialogButton, PageHeading } from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { ExpenseForm } from "@/components/vouchers/expense-form";
import { useExpensesList } from "@/hooks/use-voucher-lists";
import type { ExpenseListResult } from "@/lib/queries/expenses";
import type { SalesmanOption } from "@/lib/queries/salesmen";
import type { Company, Party, Warehouse } from "@/lib/types/database";
import Link from "next/link";

export function ExpensesView({
  company,
  initialData,
  initialSalesmen = [],
  initialWarehouses = [],
  initialVendors = [],
  initialOffline = false,
}: {
  company: Company;
  initialData?: ExpenseListResult | null;
  initialSalesmen?: SalesmanOption[];
  initialWarehouses?: Warehouse[];
  initialVendors?: Party[];
  initialOffline?: boolean;
}) {
  const { expenses, pagination, salesmen, warehouses, vendors, loading, refetch } =
    useExpensesList({
      companyId: company.id,
      initialData,
      initialSalesmen,
      initialWarehouses,
      initialVendors,
      initialOffline,
    });

  if (loading && !expenses.length) return <PageSkeleton />;

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
                warehouses={warehouses}
                vendors={vendors}
                onDone={refetch}
              />
            </CreateDialogButton>
          </>
        }
      />

      <ExpensesTable expenses={expenses} pagination={pagination} />
    </div>
  );
}

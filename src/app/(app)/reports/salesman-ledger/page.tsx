import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { FilterSelect, ReportFilters } from "@/components/reports/report-filters";
import { ReportTable } from "@/components/reports/report-table";
import { requireCompanyContext } from "@/lib/auth";
import { fetchCompanySalesmen } from "@/lib/queries/salesmen";
import { buildSalesmanLedger } from "@/lib/reports/salesman-ledger";
import { localDateIso, monthStartLocal } from "@/lib/dates";
import { formatPkr } from "@/lib/utils";
import { HandCoins, Receipt, ShoppingCart, Wallet } from "lucide-react";
import Link from "next/link";

function today() {
  return localDateIso();
}

function monthStart() {
  return monthStartLocal();
}

export default async function SalesmanLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    salesman?: string;
  }>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();
  const from = sp.from || monthStart();
  const to = sp.to || today();
  const salesmanId = sp.salesman || "";

  const [salesmen, ledger] = await Promise.all([
    fetchCompanySalesmen(supabase, company.id),
    buildSalesmanLedger(supabase, {
      companyId: company.id,
      salesmanId,
      from,
      to,
    }),
  ]);

  const t = ledger.totals;

  return (
    <div className="animate-rise space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Salesman ledger
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Running book of this salesman&apos;s sales, recoveries, salary, and
            tagged daily expenses — {company.name}
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <Link
            href="/vouchers/expenses"
            className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium"
          >
            Add salary / expense
          </Link>
          <Link
            href="/reports/accounts?view=ledger"
            className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium"
          >
            Customer ledger
          </Link>
        </div>
      </div>

      <ReportFilters
        action="/reports/salesman-ledger"
        defaults={{ from, to }}
        extras={
          <FilterSelect
            name="salesman"
            label="Salesman"
            value={salesmanId}
            allLabel="Select salesman"
            options={salesmen.map((s) => ({
              value: s.user_id,
              label: s.full_name || s.user_id.slice(0, 8),
            }))}
          />
        }
      />

      {!salesmanId ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] bg-white px-4 py-6 text-sm text-[var(--muted)]">
          Choose a salesman above to open his running ledger. Shop-wise balances
          stay on{" "}
          <Link href="/reports/accounts?view=ledger" className="font-semibold underline">
            Customer ledger
          </Link>
          .
        </p>
      ) : (
        <>
          <StatsGrid>
            <StatCard
              label="Sales"
              value={t.sales}
              format="money"
              icon={ShoppingCart}
              hint="Bills tagged to this salesman"
            />
            <StatCard
              label="Cash collected"
              value={t.collected}
              format="money"
              icon={HandCoins}
              tone="ok"
              hint="Invoice cash + recoveries"
            />
            <StatCard
              label="Salary + expenses"
              value={t.expenses}
              format="money"
              icon={Receipt}
              tone="warn"
              hint={`${formatPkr(t.salary)} salary · ${formatPkr(t.otherExpenses)} other`}
            />
            <StatCard
              label="Net cash"
              value={t.netCash}
              format="money"
              icon={Wallet}
              tone={t.netCash >= 0 ? "ok" : "danger"}
              hint="Collected minus salary & expenses"
            />
          </StatsGrid>

          {ledger.error ? (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {ledger.error}
            </p>
          ) : null}

          <ReportTable
            title={`Salesman ledger — ${ledger.salesmanName}`}
            companyName={company.name}
            subtitle={`${from} to ${to} · ${ledger.lines.length} lines`}
            rows={ledger.lines.map((l) => ({
              Date: l.date,
              Type: l.type,
              Particulars: l.particulars,
              "Sale amount": l.sales,
              "Cash collected": l.collected,
              "Expense paid": l.expense,
              "Running cash": l.running,
            }))}
            filename={`salesman-ledger-${salesmanId}-${from}-${to}`}
          />
        </>
      )}
    </div>
  );
}

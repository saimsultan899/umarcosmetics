import { ChartCard } from "@/components/analytics/chart-card";
import { DonutChart, RankBars, TrendAreaChart } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { FilterMultiSelect, ReportFilters } from "@/components/reports/report-filters";
import { ReportTable } from "@/components/reports/report-table";
import { requireCompanyContext } from "@/lib/auth";
import { EXPENSE_CATEGORIES } from "@/lib/expenses/categories";
import { fetchCompanySalesmen } from "@/lib/queries/salesmen";
import { parseReportList } from "@/lib/reports/filter-params";
import { buildExpenseReport } from "@/lib/reports/expenses-data";
import { localDateIso, monthStartLocal } from "@/lib/dates";
import { formatPkr } from "@/lib/utils";
import { Banknote, Receipt, Users, Wallet } from "lucide-react";
import Link from "next/link";

function today() {
  return localDateIso();
}

function monthStart() {
  return monthStartLocal();
}

export default async function ExpenseReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    category?: string;
    salesman?: string;
  }>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();
  const from = sp.from || monthStart();
  const to = sp.to || today();
  const categories = parseReportList(sp.category);
  const salesmanIds = parseReportList(sp.salesman);

  const [report, salesmen] = await Promise.all([
    buildExpenseReport(supabase, {
      companyId: company.id,
      from,
      to,
      categories,
      salesmanIds,
    }),
    fetchCompanySalesmen(supabase, company.id),
  ]);

  const { totals } = report;

  return (
    <div className="animate-rise space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Expense report
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Salary and daily costs by type, salesman, and day — {company.name}
          </p>
        </div>
        <Link
          href="/vouchers/expenses"
          className="no-print rounded-lg bg-[var(--brand)] px-3 py-2 text-sm font-medium text-white"
        >
          Add expense
        </Link>
      </div>

      <StatsGrid>
        <StatCard
          label="Total expenses"
          value={totals.amount}
          format="money"
          icon={Wallet}
          tone="warn"
          hint={`${totals.count} entries`}
        />
        <StatCard
          label="Salesman salary"
          value={totals.salary}
          format="money"
          icon={Users}
          href="/vouchers/expenses"
          hint="Paid to field staff"
        />
        <StatCard
          label="Other daily costs"
          value={totals.other}
          format="money"
          icon={Receipt}
          hint="Fuel, food, rent, bills, other"
        />
        <StatCard
          label="Salary share"
          value={totals.amount ? Math.round((totals.salary / totals.amount) * 100) : 0}
          format="number"
          icon={Banknote}
          hint="% of expenses that are salary"
        />
      </StatsGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Expense mix" subtitle="By type in this period">
          <DonutChart
            data={report.byCategory}
            centerLabel="Spent"
            centerValue={formatPkr(totals.amount)}
          />
        </ChartCard>
        <ChartCard
          className="lg:col-span-2"
          title="Daily spend"
          subtitle={`${from} to ${to}`}
        >
          <TrendAreaChart data={report.trend} valueLabel="Expense" />
        </ChartCard>
      </div>

      <ChartCard title="Who the cost belongs to" subtitle="Salary + tagged daily costs">
        <RankBars
          data={report.bySalesman.slice(0, 8).map((r) => ({
            name: r.name,
            value: r.total,
          }))}
        />
      </ChartCard>

      <ReportFilters
        action="/reports/expenses"
        defaults={{ from, to }}
        extras={
          <>
            <FilterMultiSelect
              name="category"
              label="Type"
              value={sp.category}
              allLabel="All types"
              options={EXPENSE_CATEGORIES.map((c) => ({
                value: c.value,
                label: c.label,
              }))}
            />
            <FilterMultiSelect
              name="salesman"
              label="Salesman"
              value={sp.salesman}
              allLabel="All salesmen"
              options={[
                ...salesmen.map((s) => ({
                  value: s.user_id,
                  label: s.full_name || s.user_id.slice(0, 8),
                })),
                { value: "unassigned", label: "Company / unassigned" },
              ]}
            />
          </>
        }
      />

      {report.error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {report.error}
        </p>
      ) : null}

      <ReportTable
        title="Salesman-wise expenses"
        companyName={company.name}
        subtitle={`${from} to ${to}`}
        rows={report.bySalesman.map((r) => ({
          Salesman: r.name,
          "Salary paid": r.salary,
          "Other expenses": r.other,
          "Total expenses": r.total,
        }))}
        filename={`expenses-salesman-${from}-${to}`}
      />

      <ReportTable
        title="Expense register"
        companyName={company.name}
        subtitle={`${report.lines.length} lines · ${from} to ${to}`}
        rows={report.lines.map((l) => ({
          Date: l.expense_date,
          "EXP #": l.expense_no,
          Type: l.categoryLabel,
          Salesman: l.salesmanName || "—",
          "Amount paid": l.amount,
          Remarks: l.remarks || "—",
        }))}
        filename={`expenses-${from}-${to}`}
      />
    </div>
  );
}

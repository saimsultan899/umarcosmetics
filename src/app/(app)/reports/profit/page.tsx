import { ChartCard } from "@/components/analytics/chart-card";
import { CompareBarChart, DonutChart, TrendAreaChart } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { ProfitPeriodFilters } from "@/components/reports/profit-period-filters";
import { ReportTable } from "@/components/reports/report-table";
import { requireCompanyContext } from "@/lib/auth";
import { buildProfitReport } from "@/lib/reports/profit-data";
import { resolveProfitPeriod } from "@/lib/reports/profit-periods";
import { amountClass, cn, formatPkr } from "@/lib/utils";
import {
  Banknote,
  Percent,
  Receipt,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ProfitReportPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const period = resolveProfitPeriod(sp);
  const { supabase, company } = await requireCompanyContext();

  const { summary, error } = await buildProfitReport(supabase, {
    companyId: company.id,
    from: period.from,
    to: period.to,
  });

  const salesTrend = summary.daily.map((d) => ({
    name: d.day.slice(5),
    value: d.net_sales,
    secondary: d.expenses,
  }));

  const expenseMix = summary.expenses_by_category.map((c) => ({
    name: c.label,
    value: c.amount,
  }));

  const compareTotals = [
    { name: "Net sales", value: summary.net_sales },
    { name: "Est. cost", value: summary.cogs },
    { name: "Gross profit", value: summary.gross_profit },
    { name: "Expenses", value: summary.expenses },
    { name: "Net profit", value: summary.net_profit },
  ];

  const purchaseGross =
    summary.purchases_gross +
    summary.purchase_trade_discount +
    summary.purchase_extra_discount;

  const plRows = [
    { Item: "Gross sales (posted invoices)", Amount: summary.sales },
    { Item: "Less: sale returns", Amount: -summary.returns },
    { Item: "Net sales", Amount: summary.net_sales },
    { Item: "Less: estimated cost of goods", Amount: -summary.cogs },
    { Item: "Gross profit (before expenses)", Amount: summary.gross_profit },
    { Item: "Purchases (before discounts)", Amount: purchaseGross },
    { Item: "Less: purchase trade discount", Amount: -summary.purchase_trade_discount },
    { Item: "Less: purchase extra discount", Amount: -summary.purchase_extra_discount },
    { Item: "Purchase invoices (payable)", Amount: summary.purchases_gross },
    { Item: "Less: purchase returns", Amount: -summary.purchase_returns },
    { Item: "Net purchases", Amount: summary.purchases },
    { Item: "Less: operating expenses", Amount: -summary.expenses },
    { Item: "  — Salesman salary", Amount: -summary.salary },
    { Item: "  — Other daily costs", Amount: -summary.other_expenses },
    { Item: "Net profit (after expenses)", Amount: summary.net_profit },
  ];

  return (
    <div className="animate-rise space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-[var(--ink)]">Profit summary</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {period.label} — {company.name}
          </p>
        </div>
        <Link
          href="/vouchers/expenses"
          className="no-print rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)]"
        >
          Add expense
        </Link>
      </div>

      <ProfitPeriodFilters preset={period.preset} from={period.from} to={period.to} />

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <StatsGrid>
        <StatCard
          label="Net sales"
          value={summary.net_sales}
          format="money"
          icon={ShoppingCart}
          hint={`Invoices ${formatPkr(summary.sales)} · Returns ${formatPkr(summary.returns)}`}
        />
        <StatCard
          label="Gross profit"
          value={summary.gross_profit}
          format="money"
          icon={TrendingUp}
          tone="ok"
          hint="Before expenses — sales minus est. product cost"
        />
        <StatCard
          label="Operating expenses"
          value={summary.expenses}
          format="money"
          icon={Receipt}
          tone="warn"
          hint={`Salary ${formatPkr(summary.salary)} · Other ${formatPkr(summary.other_expenses)}`}
        />
        <StatCard
          label="Net profit"
          value={summary.net_profit}
          format="money"
          icon={Wallet}
          tone={summary.net_profit >= 0 ? "ok" : "danger"}
          hint="Gross profit minus all expenses"
        />
        <StatCard
          label="Net purchases"
          value={summary.purchases}
          format="money"
          icon={ShoppingCart}
          hint={`Bills ${formatPkr(summary.purchases_gross)} · Returns ${formatPkr(summary.purchase_returns)}`}
        />
        <StatCard
          label="Gross margin"
          value={`${summary.gross_margin_pct}%`}
          icon={Percent}
          hint="% of net sales kept before expenses"
        />
        <StatCard
          label="Net margin"
          value={`${summary.net_margin_pct}%`}
          icon={Banknote}
          tone={summary.net_margin_pct >= 0 ? "ok" : "danger"}
          hint="% of net sales after expenses"
        />
      </StatsGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Daily net sales vs expenses"
          subtitle={`${period.from} to ${period.to}`}
        >
          <CompareBarChart
            data={salesTrend}
            valueLabel="Net sales"
            secondaryLabel="Expenses"
            height={260}
          />
        </ChartCard>

        <ChartCard title="Expense mix" subtitle="Where the money went">
          <DonutChart
            data={expenseMix}
            centerLabel="Spent"
            centerValue={formatPkr(summary.expenses)}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Profit waterfall"
          subtitle="From sales to net profit in this period"
        >
          <CompareBarChart
            data={compareTotals}
            valueLabel="Amount"
            height={240}
          />
        </ChartCard>

        <ChartCard
          title="Net profit trend"
          subtitle="Daily net sales minus daily expenses (approx.)"
        >
          <TrendAreaChart
            data={summary.daily.map((d) => ({
              name: d.day.slice(5),
              value: d.net_sales - d.expenses,
            }))}
            valueLabel="Daily result"
            height={240}
          />
        </ChartCard>
      </div>

      <div className="panel overflow-hidden">
        <div className="panel-header">
          <div>
            <h2 className="text-base font-semibold text-[var(--ink)]">
              Profit & loss statement
            </h2>
            <p className="text-sm text-[var(--muted)]">
              With and without expenses — {period.from} to {period.to}
            </p>
          </div>
        </div>
        <div className="panel-body space-y-1 p-0">
          {plRows.map((row) => {
            const highlight =
              row.Item === "Gross profit (before expenses)" ||
              row.Item === "Net profit (after expenses)";
            return (
              <div
                key={row.Item}
                className={cn(
                  "flex items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-3 last:border-b-0",
                  highlight && "bg-[var(--surface-2)]",
                )}
              >
                <span
                  className={cn(
                    "text-sm",
                    highlight ? "font-semibold text-[var(--ink)]" : "text-[var(--muted)]",
                    row.Item.startsWith("  ") && "pl-4",
                  )}
                >
                  {row.Item}
                </span>
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    amountClass,
                    row.Amount < 0 && "text-rose-700",
                    row.Amount > 0 && highlight && "text-emerald-700",
                    row.Amount > 0 && !highlight && row.Item !== "Net sales" && "text-[var(--ink)]",
                  )}
                >
                  {row.Amount < 0
                    ? `(${formatPkr(Math.abs(row.Amount))})`
                    : formatPkr(row.Amount)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-xs leading-relaxed text-[var(--muted)]">
        <span className="font-medium text-[var(--ink)]">Note:</span> Gross profit uses
        current product purchase rates (estimated cost). Recoveries, receivables, and
        purchases are not included — this is trading margin minus daily expenses.
      </p>

      <ReportTable
        title="Daily breakdown"
        companyName={company.name}
        subtitle={`${period.from} to ${period.to}`}
        rows={summary.daily.map((d) => ({
          Date: d.day,
          Sales: d.sales,
          Returns: d.returns,
          "Net sales": d.net_sales,
          Expenses: d.expenses,
          "Daily result (approx.)": d.net_sales - d.expenses,
        }))}
        filename={`profit-${period.from}-${period.to}`}
      />
    </div>
  );
}

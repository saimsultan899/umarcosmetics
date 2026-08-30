import { ChartCard } from "@/components/analytics/chart-card";
import {
  CompareBarChart,
  RankBars,
  TrendAreaChart,
} from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { FilterSelect, ReportFilters } from "@/components/reports/report-filters";
import { ReportTable } from "@/components/reports/report-table";
import { requireCompanyContext } from "@/lib/auth";
import { buildSalesmanReport } from "@/lib/reports/salesman-data";
import { formatPkr } from "@/lib/utils";
import {
  HandCoins,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default async function SalesmenPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    salesman?: string;
    sector?: string;
  }>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();
  const from = sp.from || monthStart();
  const to = sp.to || today();
  const salesmanId = sp.salesman || "";
  const sector = sp.sector || "";

  const report = await buildSalesmanReport(supabase, {
    companyId: company.id,
    from,
    to,
    salesmanId,
    sector,
  });

  const { totals } = report;
  const focused = Boolean(salesmanId);

  const topBars = report.rows
    .filter((r) => r.sales > 0)
    .slice(0, 6)
    .map((r) => ({ name: r.name, value: r.sales }));

  const salesVsCollected = report.rows
    .filter((r) => r.sales > 0 || r.collected > 0)
    .slice(0, 8)
    .map((r) => ({
      name: r.name.length > 16 ? `${r.name.slice(0, 15)}…` : r.name,
      value: r.sales,
      secondary: r.collected,
    }));

  const trend = report.trend.map((t) => ({ name: t.name, value: t.sales }));

  const reportRows = report.rows.map((r) => ({
    Salesman: r.name,
    Sectors: r.sectors.join(", ") || "—",
    Bills: r.bills,
    "Sale Amount": r.sales,
    "Invoice Cash": r.invoiceCash,
    "Cash Recovered": r.recovered,
    "Recovery Count": r.recoveryCount,
    "Total Collected": r.collected,
    "Credit Outstanding": r.credit,
    "Avg Bill": r.bills ? Math.round(r.avgBill) : 0,
  }));

  return (
    <div className="animate-rise space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Salesman Report
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Sales, collections & field recovery by salesman — {company.name}
          </p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <Link
            href="/salesman/recoveries"
            className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)]"
          >
            Field recoveries
          </Link>
          <Link
            href="/salesman"
            className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)]"
          >
            Manage salesmen
          </Link>
        </div>
      </div>

      <div className="no-print space-y-6">
        <StatsGrid>
          <StatCard
            label="Total sales"
            value={totals.sales}
            format="money"
            icon={TrendingUp}
            tone="brand"
            hint={`${report.activeCount} of ${report.rosterCount} salesmen active · ${totals.bills} bills`}
          />
          <StatCard
            label="Cash recovered"
            value={totals.recovered}
            format="money"
            icon={HandCoins}
            tone="ok"
            hint={`${totals.recoveryCount} field/office collections`}
          />
          <StatCard
            label="Total collected"
            value={totals.collected}
            format="money"
            icon={Wallet}
            tone="neutral"
            hint="Invoice cash + recoveries"
          />
          <StatCard
            label="Credit outstanding"
            value={totals.credit}
            format="money"
            icon={Users}
            tone={totals.credit > 0 ? "warn" : "ok"}
            href="/reports/aging"
            hint="Unpaid balance from these bills"
          />
        </StatsGrid>

        {!focused && (report.topBySales || report.topByRecovery) ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="panel flex items-center gap-4 p-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                <Trophy className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Top performer — sales
                </p>
                <p className="truncate text-lg font-semibold">
                  {report.topBySales?.name || "—"}
                </p>
                <p className="text-sm text-[var(--muted)]">
                  {report.topBySales
                    ? `${formatPkr(report.topBySales.sales)} · ${report.topBySales.bills} bills`
                    : "No sales in this period"}
                </p>
              </div>
            </div>
            <div className="panel flex items-center gap-4 p-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <HandCoins className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Top performer — recovery
                </p>
                <p className="truncate text-lg font-semibold">
                  {report.topByRecovery?.name || "—"}
                </p>
                <p className="text-sm text-[var(--muted)]">
                  {report.topByRecovery
                    ? `${formatPkr(report.topByRecovery.recovered)} · ${report.topByRecovery.recoveryCount} collections`
                    : "No recoveries in this period"}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <ChartCard
            className="lg:col-span-2"
            title="Sales trend"
            subtitle={`Daily posted sales · ${from} to ${to}`}
          >
            <TrendAreaChart data={trend} valueLabel="Sales" />
          </ChartCard>
          <ChartCard title="Top salesmen" subtitle="By sales value in period">
            <RankBars data={topBars} />
          </ChartCard>
        </div>

        <ChartCard
          title="Sales vs. collections"
          subtitle="Collected = invoice cash + field recovery — a tall gap means credit is building"
        >
          <CompareBarChart
            data={salesVsCollected}
            valueLabel="Sales"
            secondaryLabel="Collected"
            height={260}
          />
        </ChartCard>
      </div>

      <ReportFilters
        action="/sales/salesmen"
        defaults={{ from, to }}
        extras={
          <>
            <FilterSelect
              name="salesman"
              label="Salesman"
              value={salesmanId}
              allLabel="All salesmen"
              options={report.salesmanOptions}
            />
            <FilterSelect
              name="sector"
              label="Sector"
              value={sector}
              allLabel="All sectors"
              options={report.sectorOptions.map((s) => ({ value: s, label: s }))}
            />
          </>
        }
      />

      {report.error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {report.error}
        </p>
      ) : null}

      {report.unassignedRecovered > 0 && !salesmanId ? (
        <p className="no-print rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {formatPkr(report.unassignedRecovered)} recovered without a salesman selected
          and without a sector assignment. Select salesman when recording recovery, or
          assign sectors in{" "}
          <Link href="/salesman" className="font-semibold underline">
            Sales → Salesmen
          </Link>
          .
        </p>
      ) : null}

      {report.history ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ReportTable
            title="Sales history"
            companyName={company.name}
            subtitle={`${report.history.sales.length} bills · ${from} to ${to}`}
            rows={report.history.sales.map((s) => ({
              Date: s.invoice_date,
              "Invoice #": s.invoice_no,
              Party: s.party,
              Sector: s.route || "—",
              Amount: s.amount,
            }))}
            filename={`salesman-sales-${salesmanId}-${from}`}
          />
          <ReportTable
            title="Recovery history"
            companyName={company.name}
            subtitle={`${report.history.recoveries.length} collections · ${from} to ${to}`}
            rows={report.history.recoveries.map((r) => ({
              Date: r.recovery_date,
              Party: r.party,
              Sector: r.route || "—",
              Amount: r.amount,
              Remarks: r.remarks || "—",
            }))}
            filename={`salesman-recoveries-${salesmanId}-${from}`}
          />
        </div>
      ) : (
        <p className="no-print rounded-lg border border-dashed border-[var(--border)] bg-white px-4 py-3 text-sm text-[var(--muted)]">
          Tip: choose a <strong>Salesman</strong> in the filters above to see that
          person&apos;s sale bills and recovery lines. Make sure each new sale /
          recovery selects a salesman so it appears here.
        </p>
      )}

      <ReportTable
        title="Salesman-wise performance & recovery"
        companyName={company.name}
        subtitle={`${from} to ${to} · ${report.rows.length} salesman${
          report.rows.length === 1 ? "" : "en"
        }${salesmanId ? " · filtered view" : " · pick a salesman filter for line history"}`}
        rows={reportRows}
        filename={`salesman-report-${from}-${to}`}
      />
    </div>
  );
}

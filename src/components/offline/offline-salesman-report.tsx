"use client";

import { ChartCard } from "@/components/analytics/chart-card";
import {
  CompareBarChart,
  RankBars,
  TrendAreaChart,
} from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { FilterMultiSelect, ReportFilters } from "@/components/reports/report-filters";
import { ReportTable } from "@/components/reports/report-table";
import { OfflineBanner } from "@/components/offline/offline-banner";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useOfflineData } from "@/hooks/use-offline-data";
import { formatPkr } from "@/lib/utils";
import { parseReportList } from "@/lib/reports/filter-params";
import type { Party } from "@/lib/types/database";
import {
  HandCoins,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

type OfflineSalesmanReportProps = {
  companyId: string;
  companyName: string;
  from: string;
  to: string;
  salesman?: string;
  sector?: string;
};

export function OfflineSalesmanReportPage({
  companyId,
  companyName,
  from,
  to,
  salesman: salesmanParam,
  sector: sectorParam,
}: OfflineSalesmanReportProps) {
  const salesmanFilterList = useMemo(() => parseReportList(salesmanParam), [salesmanParam]);
  const sectorFilterList = useMemo(() => parseReportList(sectorParam), [sectorParam]);

  const { data: salesmenRows, loading: salesmenLoading } = useOfflineData("salesmen", companyId);
  const { data: partiesRows, loading: partiesLoading } = useOfflineData<Party>("parties", companyId);
  const { data: salesRows, loading: salesLoading } = useOfflineData("sale_invoices", companyId);
  const { data: voucherRows, loading: vouchersLoading } = useOfflineData("vouchers", companyId);
  const { data: expenseRows, loading: expensesLoading } = useOfflineData("expenses", companyId);

  const loading = salesmenLoading || partiesLoading || salesLoading || vouchersLoading || expensesLoading;

  const partyMap = useMemo(() => new Map(partiesRows.map((p) => [p.id, p])), [partiesRows]);

  const sectorOptions = useMemo(() => {
    return Array.from(
      new Set(
        partiesRows
          .map((p) => p.route)
          .filter(Boolean) as string[],
      ),
    ).sort();
  }, [partiesRows]);

  const salesmanOptions = useMemo(() => {
    return salesmenRows
      .map((s) => ({
        value: String(s.id),
        label: String(s.full_name || s.name || s.code || s.id),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [salesmenRows]);

  // Aggregate salesman stats from local data
  const report = useMemo(() => {
    // Roster of salesmen
    type SAccum = {
      id: string;
      name: string;
      sectors: Set<string>;
      bills: number;
      sales: number;
      invoiceCash: number;
      credit: number;
      recovered: number;
      recoveryCount: number;
      collected: number;
      salary: number;
      otherExpenses: number;
      totalExpenses: number;
      avgBill: number;
    };

    const map = new Map<string, SAccum>();

    for (const s of salesmenRows) {
      const id = String(s.id);
      map.set(id, {
        id,
        name: String(s.full_name || s.name || s.code || id),
        sectors: new Set<string>(),
        bills: 0,
        sales: 0,
        invoiceCash: 0,
        credit: 0,
        recovered: 0,
        recoveryCount: 0,
        collected: 0,
        salary: 0,
        otherExpenses: 0,
        totalExpenses: 0,
        avgBill: 0,
      });
    }

    const unassignedId = "unassigned";
    map.set(unassignedId, {
      id: unassignedId,
      name: "Unassigned / Direct",
      sectors: new Set<string>(),
      bills: 0,
      sales: 0,
      invoiceCash: 0,
      credit: 0,
      recovered: 0,
      recoveryCount: 0,
      collected: 0,
      salary: 0,
      otherExpenses: 0,
      totalExpenses: 0,
      avgBill: 0,
    });

    // Trend accumulation by day
    const trendMap = new Map<string, { sales: number; recovered: number }>();

    // 1. Process Sale Invoices
    const salesHistory: Array<{
      invoice_no: string;
      invoice_date: string;
      party: string;
      route?: string;
      amount: number;
      salesman_id: string;
    }> = [];

    for (const inv of salesRows) {
      const d = String(inv.invoice_date || inv.doc_date || "").slice(0, 10);
      if (from && d < from) continue;
      if (to && d > to) continue;

      const party = partyMap.get(String(inv.party_id || ""));
      const route = party?.route || String(inv.route || "");
      if (sectorFilterList.length && (!route || !sectorFilterList.includes(route))) continue;

      const sid = inv.salesman_id ? String(inv.salesman_id) : unassignedId;
      const target = map.get(sid) || map.get(unassignedId)!;

      const total = Number(inv.grand_total || inv.amount || 0);
      const paid = Number(inv.amount_paid || (String(inv.payment_type).toLowerCase() === "cash" ? total : 0));

      target.bills += 1;
      target.sales += total;
      target.invoiceCash += paid;
      target.credit += Math.max(0, total - paid);
      if (route) target.sectors.add(route);

      if (d) {
        const cur = trendMap.get(d) || { sales: 0, recovered: 0 };
        cur.sales += total;
        trendMap.set(d, cur);
      }

      salesHistory.push({
        invoice_no: String(inv.invoice_no || inv.doc_no || inv.id),
        invoice_date: d,
        party: String(party?.name_en || inv.party_name || "—"),
        route,
        amount: total,
        salesman_id: sid,
      });
    }

    // 2. Process Recoveries
    const recoveryHistory: Array<{
      recovery_date: string;
      party: string;
      route?: string;
      amount: number;
      remarks?: string;
      salesman_id: string;
    }> = [];

    for (const rec of voucherRows) {
      const t = String(rec.voucher_type || rec.type || "");
      if (t !== "recovery" && t !== "cash_receipt" && t !== "CR" && t) continue;

      const d = String(rec.recovery_date || rec.voucher_date || rec.doc_date || "").slice(0, 10);
      if (from && d < from) continue;
      if (to && d > to) continue;

      const party = partyMap.get(String(rec.party_id || ""));
      const route = party?.route || String(rec.route || "");
      if (sectorFilterList.length && (!route || !sectorFilterList.includes(route))) continue;

      const sid = rec.salesman_id ? String(rec.salesman_id) : unassignedId;
      const target = map.get(sid) || map.get(unassignedId)!;

      const amt = Number(rec.amount ?? rec.total_amount ?? rec.grand_total ?? 0);
      target.recovered += amt;
      target.recoveryCount += 1;
      if (route) target.sectors.add(route);

      if (d) {
        const cur = trendMap.get(d) || { sales: 0, recovered: 0 };
        cur.recovered += amt;
        trendMap.set(d, cur);
      }

      recoveryHistory.push({
        recovery_date: d,
        party: String(party?.name_en || rec.party_name || "—"),
        route,
        amount: amt,
        remarks: rec.remarks == null ? undefined : String(rec.remarks),
        salesman_id: sid,
      });
    }

    // 3. Process Expenses
    const expenseHistory: Array<{
      expense_date: string;
      expense_no: string;
      category: string;
      amount: number;
      remarks?: string;
      salesman_id: string;
    }> = [];

    for (const exp of expenseRows) {
      const d = String(exp.expense_date || exp.doc_date || "").slice(0, 10);
      if (from && d < from) continue;
      if (to && d > to) continue;

      const sid = exp.salesman_id ? String(exp.salesman_id) : unassignedId;
      const target = map.get(sid) || map.get(unassignedId)!;

      const amt = Number(exp.amount || exp.grand_total || 0);
      const cat = String(exp.category || "").toLowerCase();
      if (cat.includes("salary")) {
        target.salary += amt;
      } else {
        target.otherExpenses += amt;
      }
      target.totalExpenses += amt;

      expenseHistory.push({
        expense_date: d,
        expense_no: String(exp.expense_no || exp.doc_no || exp.id),
        category: String(exp.category || "Expense"),
        amount: amt,
        remarks: exp.remarks == null ? undefined : String(exp.remarks),
        salesman_id: sid,
      });
    }

    // Finalize rows
    let allRows = Array.from(map.values()).map((s) => {
      s.collected = s.invoiceCash + s.recovered;
      s.avgBill = s.bills ? s.sales / s.bills : 0;
      return {
        ...s,
        sectors: Array.from(s.sectors).sort(),
      };
    });

    // Apply salesmanFilter if present
    if (salesmanFilterList.length) {
      allRows = allRows.filter((r) => salesmanFilterList.includes(r.id));
    } else {
      // Filter out empty rows unless unassigned has values
      allRows = allRows.filter((r) => r.id !== unassignedId || r.sales > 0 || r.recovered > 0);
    }

    const totals = allRows.reduce(
      (acc, r) => {
        acc.bills += r.bills;
        acc.sales += r.sales;
        acc.invoiceCash += r.invoiceCash;
        acc.credit += r.credit;
        acc.recovered += r.recovered;
        acc.recoveryCount += r.recoveryCount;
        acc.collected += r.collected;
        acc.salary += r.salary;
        acc.otherExpenses += r.otherExpenses;
        acc.totalExpenses += r.totalExpenses;
        return acc;
      },
      {
        bills: 0,
        sales: 0,
        invoiceCash: 0,
        credit: 0,
        recovered: 0,
        recoveryCount: 0,
        collected: 0,
        salary: 0,
        otherExpenses: 0,
        totalExpenses: 0,
      },
    );

    const sortedBySales = allRows.slice().sort((a, b) => b.sales - a.sales);
    const sortedByRecovery = allRows.slice().sort((a, b) => b.recovered - a.recovered);
    const topBySales = sortedBySales[0]?.sales > 0 ? sortedBySales[0] : null;
    const topByRecovery = sortedByRecovery[0]?.recovered > 0 ? sortedByRecovery[0] : null;

    const trend = Array.from(trendMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-30)
      .map(([name, data]) => ({ name, sales: data.sales, recovered: data.recovered }));

    return {
      rows: allRows,
      totals,
      topBySales,
      topByRecovery,
      trend,
      history:
        salesmanFilterList.length === 1
          ? {
              sales: salesHistory.filter((s) => s.salesman_id === salesmanFilterList[0]),
              recoveries: recoveryHistory.filter((r) => r.salesman_id === salesmanFilterList[0]),
              expenses: expenseHistory.filter((e) => e.salesman_id === salesmanFilterList[0]),
            }
          : null,
    };
  }, [salesmenRows, partiesRows, salesRows, voucherRows, expenseRows, from, to, partyMap, sectorFilterList, salesmanFilterList]);

  if (loading) {
    return (
      <div className="animate-rise space-y-6">
        <OfflineBanner companyId={companyId} />
        <PageSkeleton />
      </div>
    );
  }

  const focused = salesmanFilterList.length === 1;
  const focusedSalesmanId = salesmanFilterList[0] || "";

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

  const trendData = report.trend.map((t) => ({ name: t.name, value: t.sales }));

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
    "Salary paid": r.salary,
    "Other expenses": r.otherExpenses,
    "Total expenses": r.totalExpenses,
    "Avg Bill": r.bills ? Math.round(r.avgBill) : 0,
  }));

  return (
    <div className="animate-rise space-y-6">
      <OfflineBanner companyId={companyId} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Salesman Report
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Sales, collections & field recovery by salesman — {companyName} (offline)
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
            href="/reports/salesman-ledger"
            className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)]"
          >
            Salesman ledger
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
            value={report.totals.sales}
            format="money"
            icon={TrendingUp}
            tone="brand"
            hint={`${report.totals.bills} bills from local records`}
          />
          <StatCard
            label="Cash recovered"
            value={report.totals.recovered}
            format="money"
            icon={HandCoins}
            tone="ok"
            hint={`${report.totals.recoveryCount} collections (local)`}
          />
          <StatCard
            label="Total collected"
            value={report.totals.collected}
            format="money"
            icon={Wallet}
            tone="neutral"
            hint="Invoice cash + recoveries"
          />
          <StatCard
            label="Credit outstanding"
            value={report.totals.credit}
            format="money"
            icon={Users}
            tone={report.totals.credit > 0 ? "warn" : "ok"}
            href="/reports/aging"
            hint="Unpaid balance from these bills"
          />
          <StatCard
            label="Salary & expenses"
            value={report.totals.totalExpenses}
            format="money"
            icon={Wallet}
            tone={report.totals.totalExpenses > 0 ? "warn" : "neutral"}
            href="/reports/expenses"
            hint={`${formatPkr(report.totals.salary)} salary · ${formatPkr(report.totals.otherExpenses)} other`}
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
            <TrendAreaChart data={trendData} valueLabel="Sales" />
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
            <FilterMultiSelect
              name="salesman"
              label="Salesman"
              value={salesmanParam}
              allLabel="All salesmen"
              options={salesmanOptions}
            />
            <FilterMultiSelect
              name="sector"
              label="Sector"
              value={sectorParam}
              allLabel="All sectors"
              options={sectorOptions.map((s) => ({ value: s, label: s }))}
            />
          </>
        }
      />

      {report.history ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <ReportTable
            title="Sales history"
            companyName={companyName}
            subtitle={`${report.history.sales.length} bills · ${from} to ${to}`}
            rows={report.history.sales.map((s) => ({
              Date: s.invoice_date,
              "Invoice #": s.invoice_no,
              Customer: s.party,
              Sector: s.route || "—",
              Amount: s.amount,
            }))}
            filename={`salesman-sales-${focusedSalesmanId}-${from}`}
          />
          <ReportTable
            title="Recovery history"
            companyName={companyName}
            subtitle={`${report.history.recoveries.length} collections · ${from} to ${to}`}
            rows={report.history.recoveries.map((r) => ({
              Date: r.recovery_date,
              Customer: r.party,
              Sector: r.route || "—",
              Amount: r.amount,
              Remarks: r.remarks || "—",
            }))}
            filename={`salesman-recoveries-${focusedSalesmanId}-${from}`}
          />
          <ReportTable
            title="Salary & expenses"
            companyName={companyName}
            subtitle={`${report.history.expenses.length} lines · ${from} to ${to}`}
            rows={report.history.expenses.map((e) => ({
              Date: e.expense_date,
              "EXP #": e.expense_no,
              Type: e.category,
              "Amount paid": e.amount,
              Remarks: e.remarks || "—",
            }))}
            filename={`salesman-expenses-${focusedSalesmanId}-${from}`}
          />
        </div>
      ) : null}

      <ReportTable
        title="Salesman-wise performance & recovery"
        companyName={companyName}
        subtitle={`${from} to ${to} · ${report.rows.length} salesman${
          report.rows.length === 1 ? "" : "en"
        }${focused ? " · filtered view" : " · pick a salesman filter for line history"}`}
        rows={reportRows}
        filename={`salesman-report-${from}-${to}`}
      />
    </div>
  );
}

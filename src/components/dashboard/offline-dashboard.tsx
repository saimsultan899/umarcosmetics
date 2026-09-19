"use client";

import { ChartCard } from "@/components/analytics/chart-card";
import {
  CompareBarChart,
  DonutChart,
  RankBars,
  TrendAreaChart,
} from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { QuickShortcuts } from "@/components/dashboard/quick-shortcuts";
import { useSyncStatus } from "@/components/offline/sync-provider";
import {
  compareByDay,
  groupSum,
  lastNDates,
  sumByDay,
} from "@/lib/analytics/aggregate";
import {
  offlineExpensesSummary,
  offlinePurchasesSummary,
  offlineRecoverySummary,
  offlineSalesSummary,
  offlineStockSnapshot,
} from "@/lib/offline/offline-reports";
import { amountClass, cn, formatNumber, formatPkr } from "@/lib/utils";
import {
  AlertTriangle,
  Package,
  ShoppingCart,
  TrendingUp,
  Truck,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type DashState = {
  salesToday: number;
  recoveriesToday: number;
  expenseToday: number;
  weekSalesTotal: number;
  weekRecoveryTotal: number;
  weekExpenseTotal: number;
  lowStockCount: number;
  overLimitCount: number;
  receivableApprox: number;
  payableApprox: number;
  salesTrend: Array<{ name: string; value: number }>;
  recoveryTrend: Array<{ name: string; value: number }>;
  salesVsPurchases: Array<{ name: string; value: number; secondary?: number }>;
  mix: Array<{ name: string; value: number }>;
  cityBars: Array<{ name: string; value: number }>;
  lowWatch: Array<{
    code: string;
    name: string;
    warehouse: string;
    qty: number;
    reorder: number;
  }>;
  recentSales: Array<{
    id: string;
    invoice_no: string;
    party: string;
    grand_total: number;
  }>;
};

const emptyDash: DashState = {
  salesToday: 0,
  recoveriesToday: 0,
  expenseToday: 0,
  weekSalesTotal: 0,
  weekRecoveryTotal: 0,
  weekExpenseTotal: 0,
  lowStockCount: 0,
  overLimitCount: 0,
  receivableApprox: 0,
  payableApprox: 0,
  salesTrend: [],
  recoveryTrend: [],
  salesVsPurchases: [],
  mix: [],
  cityBars: [],
  lowWatch: [],
  recentSales: [],
};

/**
 * Same layout as the online dashboard — data from SQLite / local cache.
 */
export function OfflineDashboard({
  companyId,
  userName,
}: {
  companyId: string;
  userName?: string | null;
}) {
  const { pending, lastSync } = useSyncStatus();
  const [loading, setLoading] = useState(true);
  const [dash, setDash] = useState<DashState>(emptyDash);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const from14 = lastNDates(14)[0];
    const from7 = lastNDates(7)[0];
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const [sales14, purchases14, recovery14, expenses14, stock] =
          await Promise.all([
            offlineSalesSummary({ companyId, from: from14, to: today }),
            offlinePurchasesSummary({ companyId, from: from14, to: today }),
            offlineRecoverySummary({ companyId, from: from14, to: today }),
            offlineExpensesSummary({ companyId, from: from14, to: today }),
            offlineStockSnapshot(companyId),
          ]);
        if (cancelled) return;

        const salesToday = sales14.rows
          .filter((r) => String(r.invoice_date).slice(0, 10) === today)
          .reduce((s, r) => s + Number(r.grand_total || 0), 0);
        const recoveriesToday = recovery14.rows
          .filter((r) =>
            String(r.voucher_date || r.doc_date || "").slice(0, 10) === today,
          )
          .reduce(
            (s, r) => s + Number(r.amount ?? r.total_amount ?? r.grand_total ?? 0),
            0,
          );
        const expenseToday = expenses14.rows
          .filter(
            (r) =>
              String(r.expense_date || r.doc_date || "").slice(0, 10) === today,
          )
          .reduce((s, r) => s + Number(r.amount ?? r.total_amount ?? 0), 0);

        const salesTrend = sumByDay(
          sales14.rows.map((r) => ({
            date: String(r.invoice_date).slice(0, 10),
            amount: Number(r.grand_total || 0),
          })),
          14,
        );
        const recoveryTrend = sumByDay(
          recovery14.rows.map((r) => ({
            date: String(r.voucher_date || r.doc_date || "").slice(0, 10),
            amount: Number(r.amount ?? r.total_amount ?? r.grand_total ?? 0),
          })),
          7,
        );
        const salesVsPurchases = compareByDay(
          sales14.rows.map((r) => ({
            date: String(r.invoice_date).slice(0, 10),
            amount: Number(r.grand_total || 0),
          })),
          purchases14.rows.map((r) => ({
            date: String(r.invoice_date).slice(0, 10),
            amount: Number(r.grand_total || 0),
          })),
          7,
        );
        const mix = groupSum(
          sales14.rows.map((r) => ({
            key: String(r.payment_type || "credit").toUpperCase(),
            amount: Number(r.grand_total || 0),
          })),
          4,
        );
        const cityBars = groupSum(
          sales14.rows.map((r) => ({
            key: String(r.city || "No city"),
            amount: Number(r.grand_total || 0),
          })),
          5,
        );

        const lowWatch = stock
          .map((s) => {
            const row = s as Record<string, unknown>;
            const products = row.products as
              | { code?: string; name_en?: string; reorder_level?: number }
              | undefined;
            const warehouse = row.warehouses as { name?: string } | undefined;
            const reorder = Number(products?.reorder_level ?? 0);
            return {
              code: String(products?.code || ""),
              name: String(products?.name_en || ""),
              warehouse: String(warehouse?.name || "—"),
              qty: Number(s.qty) || 0,
              reorder,
            };
          })
          .filter((r) => r.reorder > 0 && r.qty <= r.reorder)
          .slice(0, 5);

        const weekSalesTotal = salesTrend
          .slice(-7)
          .reduce((a, b) => a + b.value, 0);
        const weekRecoveryTotal = recoveryTrend.reduce((a, b) => a + b.value, 0);
        const weekExpenseTotal = expenses14.rows
          .filter(
            (r) => String(r.expense_date || r.doc_date || "").slice(0, 10) >= from7,
          )
          .reduce((s, r) => s + Number(r.amount ?? r.total_amount ?? 0), 0);

        // Local approximations until full AR/AP ledger is in SQLite
        const creditSales = sales14.rows
          .filter((r) => String(r.payment_type || "").toLowerCase() !== "cash")
          .reduce((s, r) => s + Number(r.grand_total || 0), 0);

        const recentSales = [...sales14.rows]
          .sort((a, b) =>
            String(b.invoice_date || "").localeCompare(String(a.invoice_date || "")),
          )
          .slice(0, 3)
          .map((r) => {
            const party = Array.isArray(r.parties) ? r.parties[0] : r.parties;
            return {
              id: String(r.id),
              invoice_no: String(r.invoice_no || r.id),
              party: String(
                (party as { name_en?: string } | undefined)?.name_en ||
                  r.party_name ||
                  "—",
              ),
              grand_total: Number(r.grand_total) || 0,
            };
          });

        setDash({
          salesToday,
          recoveriesToday,
          expenseToday,
          weekSalesTotal,
          weekRecoveryTotal,
          weekExpenseTotal,
          lowStockCount: lowWatch.length,
          overLimitCount: 0,
          receivableApprox: creditSales,
          payableApprox: purchases14.total,
          salesTrend,
          recoveryTrend,
          salesVsPurchases,
          mix,
          cityBars,
          lowWatch,
          recentSales,
        });
      } catch (err) {
        console.warn("[offline-dashboard] load failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const firstName = userName?.trim().split(/\s+/)[0] || "there";
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  if (loading) {
    return (
      <div className="animate-rise min-w-0 space-y-4">
        <div className="action-bar action-bar--split">
          <p className="shrink-0 text-sm font-semibold text-[var(--ink)]">
            {greeting}, {firstName}
          </p>
          <QuickShortcuts className="min-w-0" />
        </div>
        <p className="text-sm text-[var(--muted)]">Loading local dashboard…</p>
      </div>
    );
  }

  return (
    <div className="animate-rise min-w-0 space-y-4">
      <div className="action-bar action-bar--split">
        <div className="min-w-0">
          <p className="shrink-0 text-sm font-semibold text-[var(--ink)]">
            {greeting}, {firstName}
          </p>
          <p className="text-xs text-[var(--muted)]">
            Local ledger
            {lastSync
              ? ` · last synced ${new Date(lastSync).toLocaleString()}`
              : ""}
            {pending.total > 0 ? ` · ${pending.total} queued to sync` : ""}
          </p>
        </div>
        <QuickShortcuts className="min-w-0" />
      </div>

      <StatsGrid fluid>
        <StatCard
          label="Today sales"
          value={dash.salesToday}
          format="money"
          icon={ShoppingCart}
          href="/sales/invoices"
          hint={`Last 7 days: ${formatPkr(dash.weekSalesTotal)}`}
        />
        <StatCard
          label="Today recoveries"
          value={dash.recoveriesToday}
          format="money"
          icon={Wallet}
          tone="ok"
          href="/reports/recovery"
          hint={`Last 7 days collected: ${formatPkr(dash.weekRecoveryTotal)}`}
        />
        <StatCard
          label="Receivable"
          value={dash.receivableApprox}
          format="money"
          icon={TrendingUp}
          tone="warn"
          href="/reports/accounts?view=receivable"
          hint="Approx. from local credit sales"
        />
        <StatCard
          label="Payable"
          value={dash.payableApprox}
          format="money"
          icon={Truck}
          href="/reports/accounts?view=payable"
          hint="Approx. from local purchases (14d)"
        />
        <StatCard
          label="Low stock SKUs"
          value={dash.lowStockCount}
          format="number"
          icon={Package}
          tone={dash.lowStockCount > 0 ? "warn" : "ok"}
          href="/reports/stock"
          hint="Below reorder level — refill soon"
        />
        <StatCard
          label="Over credit limit"
          value={dash.overLimitCount}
          format="number"
          icon={AlertTriangle}
          tone={dash.overLimitCount > 0 ? "danger" : "ok"}
          href="/reports/accounts?view=receivable"
          hint="Needs online balances for full accuracy"
        />
        <StatCard
          label="Today expenses"
          value={dash.expenseToday}
          format="money"
          icon={Wallet}
          tone={dash.expenseToday > 0 ? "warn" : "neutral"}
          href="/reports/expenses"
          hint={`Last 7 days: ${formatPkr(dash.weekExpenseTotal)}`}
        />
      </StatsGrid>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="14-day sales trend"
          subtitle="Daily posted sales — spot slow or strong days instantly"
          action={
            <Link
              href="/reports/sales"
              className="text-sm font-medium text-[var(--brand)]"
            >
              Reports
            </Link>
          }
        >
          <TrendAreaChart
            data={dash.salesTrend}
            valueLabel="Sales"
            height={260}
          />
        </ChartCard>

        <ChartCard title="Payment mix" subtitle="Cash vs credit (last 14 days)">
          <DonutChart
            data={dash.mix}
            centerLabel="Sales mix"
            centerValue={formatPkr(
              dash.mix.reduce((a, b) => a + b.value, 0),
            )}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Sales vs purchases"
          subtitle="This week — are purchases feeding sales?"
        >
          <CompareBarChart
            data={dash.salesVsPurchases}
            valueLabel="Sales"
            secondaryLabel="Purchases"
            height={240}
          />
        </ChartCard>

        <ChartCard
          title="Recovery momentum"
          subtitle="Cash collected from shops (last 7 days)"
        >
          <TrendAreaChart
            data={dash.recoveryTrend}
            valueLabel="Recovery"
            height={240}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Top cities by sales" subtitle="Where demand is strongest">
          <RankBars data={dash.cityBars} />
        </ChartCard>

        <ChartCard
          title="Top debtors"
          subtitle="Highest outstanding balances"
        >
          <p className="text-sm text-[var(--muted)]">
            Full debtor balances need online sync. Use Customer receivables when
            connected.
          </p>
        </ChartCard>

        <ChartCard
          title="Low stock watch"
          subtitle="SKUs at or below reorder level"
        >
          <div className="space-y-2">
            {dash.lowWatch.length ? (
              dash.lowWatch.map((r, idx) => (
                <div key={idx} className="panel-note">
                  <p className="font-medium">
                    {r.code} — {r.name}
                  </p>
                  <p className="text-xs text-amber-800">
                    {r.warehouse}: {formatNumber(r.qty, 0)} / reorder{" "}
                    {formatNumber(r.reorder, 0)}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-[var(--muted)]">
                Stock levels look healthy.
              </p>
            )}
          </div>

          <h3 className="mt-5 text-sm font-semibold">Recent sales</h3>
          <div className="mt-2 space-y-2">
            {dash.recentSales.length ? (
              dash.recentSales.map((inv) => (
                <Link
                  key={inv.id}
                  href={`/sales/invoices/${inv.id}`}
                  className="panel-list-item"
                >
                  <div>
                    <p className="font-medium">{inv.invoice_no}</p>
                    <p className="text-xs text-[var(--muted)]">{inv.party}</p>
                  </div>
                  <p className={cn("font-semibold", amountClass)}>
                    {formatPkr(inv.grand_total)}
                  </p>
                </Link>
              ))
            ) : (
              <p className="text-sm text-[var(--muted)]">No local sales yet.</p>
            )}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}

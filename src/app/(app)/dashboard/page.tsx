import { ChartCard } from "@/components/analytics/chart-card";
import {
  CompareBarChart,
  DonutChart,
  RankBars,
  TrendAreaChart,
} from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { requireCompanyContext } from "@/lib/auth";
import {
  compareByDay,
  groupSum,
  lastNDates,
  sumByDay,
} from "@/lib/analytics/aggregate";
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
import { QuickShortcuts } from "@/components/dashboard/quick-shortcuts";

export default async function DashboardPage() {
  const { supabase, company, profile } = await requireCompanyContext();
  const today = new Date().toISOString().slice(0, 10);
  const from14 = lastNDates(14)[0];
  const firstName =
    profile?.full_name?.trim().split(/\s+/)[0] || "there";
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const [
    { data: snap },
    { data: topDebtors },
    { data: lowStock },
    { data: recentSales },
    { data: salesRows },
    { data: purchaseRows },
    { data: recoveryRows },
    { data: paymentMix },
    { data: expenseRows },
  ] = await Promise.all([
    supabase.rpc("get_dashboard_snapshot", {
      p_company_id: company.id,
      p_date: today,
    }),
    supabase.rpc("get_recovery_sheet", {
      p_company_id: company.id,
      p_as_of: today,
      p_city: null,
      p_route: null,
    }),
    supabase
      .from("stock_balances")
      .select("qty, products(code, name_en, reorder_level), warehouses(name)")
      .eq("company_id", company.id)
      .limit(80),
    supabase
      .from("sale_invoices")
      .select("id, invoice_no, invoice_date, grand_total, parties(name_en)")
      .eq("company_id", company.id)
      .eq("status", "posted")
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("sale_invoices")
      .select("invoice_date, grand_total, payment_type, city")
      .eq("company_id", company.id)
      .eq("status", "posted")
      .gte("invoice_date", from14),
    supabase
      .from("purchase_invoices")
      .select("invoice_date, grand_total")
      .eq("company_id", company.id)
      .eq("status", "posted")
      .gte("invoice_date", from14),
    supabase
      .from("recoveries")
      .select("recovery_date, amount")
      .eq("company_id", company.id)
      .gte("recovery_date", from14),
    supabase
      .from("sale_invoices")
      .select("payment_type, grand_total")
      .eq("company_id", company.id)
      .eq("status", "posted")
      .gte("invoice_date", from14),
    supabase
      .from("expenses")
      .select("expense_date, amount, category")
      .eq("company_id", company.id)
      .gte("expense_date", from14),
  ]);

  const s = (snap || {}) as Record<string, number>;
  const debtors = ((topDebtors || []) as Array<{
    party_id: string;
    party_code: string;
    name_en: string;
    balance: number;
    credit_limit: number;
  }>)
    .filter((d) => Number(d.balance) > 0)
    .slice(0, 6);

  const low = (lowStock || [])
    .map((row) => {
      const product = Array.isArray(row.products) ? row.products[0] : row.products;
      const warehouse = Array.isArray(row.warehouses)
        ? row.warehouses[0]
        : row.warehouses;
      return { product, warehouse, qty: Number(row.qty) };
    })
    .filter(
      (r) =>
        r.product &&
        Number(r.product.reorder_level) > 0 &&
        r.qty <= Number(r.product.reorder_level),
    )
    .slice(0, 5);

  const salesTrend = sumByDay(
    (salesRows || []).map((r) => ({
      date: r.invoice_date,
      amount: Number(r.grand_total || 0),
    })),
    14,
  );

  const salesVsPurchases = compareByDay(
    (salesRows || []).map((r) => ({
      date: r.invoice_date,
      amount: Number(r.grand_total || 0),
    })),
    (purchaseRows || []).map((r) => ({
      date: r.invoice_date,
      amount: Number(r.grand_total || 0),
    })),
    7,
  );

  const recoveryTrend = sumByDay(
    (recoveryRows || []).map((r) => ({
      date: r.recovery_date,
      amount: Number(r.amount || 0),
    })),
    7,
  );

  const mix = groupSum(
    (paymentMix || []).map((r) => ({
      key: String(r.payment_type || "credit").toUpperCase(),
      amount: Number(r.grand_total || 0),
    })),
    4,
  );

  const cityBars = groupSum(
    (salesRows || []).map((r) => ({
      key: r.city || "No city",
      amount: Number(r.grand_total || 0),
    })),
    5,
  );

  const weekSalesTotal = salesTrend.slice(-7).reduce((a, b) => a + b.value, 0);
  const weekRecoveryTotal = recoveryTrend.reduce((a, b) => a + b.value, 0);
  const expenseToday = (expenseRows || [])
    .filter((r) => r.expense_date === today)
    .reduce((s, r) => s + Number(r.amount || 0), 0);
  const weekExpenseTotal = (expenseRows || [])
    .filter((r) => r.expense_date >= lastNDates(7)[0])
    .reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <div className="animate-rise min-w-0 space-y-4">
      <div className="action-bar action-bar--split">
        <p className="shrink-0 text-sm font-semibold text-[var(--ink)]">
          {greeting}, {firstName}
        </p>
        <QuickShortcuts className="min-w-0" />
      </div>

      <StatsGrid fluid>
        <StatCard
          label="Today sales"
          value={s.sales_today || 0}
          format="money"
          icon={ShoppingCart}
          href="/sales/invoices"
          hint={`Last 7 days: ${formatPkr(weekSalesTotal)}`}
        />
        <StatCard
          label="Today recoveries"
          value={s.recoveries_today || 0}
          format="money"
          icon={Wallet}
          tone="ok"
          href="/reports/recovery"
          hint={`Last 7 days collected: ${formatPkr(weekRecoveryTotal)}`}
        />
        <StatCard
          label="Receivable"
          value={s.receivable || 0}
          format="money"
          icon={TrendingUp}
          tone="warn"
          href="/reports/accounts?view=receivable"
          hint="Money customers still owe you"
        />
        <StatCard
          label="Payable"
          value={s.payable || 0}
          format="money"
          icon={Truck}
          href="/reports/accounts?view=payable"
          hint="Money you still owe vendors"
        />
        <StatCard
          label="Low stock SKUs"
          value={s.low_stock_count || 0}
          format="number"
          icon={Package}
          tone={(s.low_stock_count || 0) > 0 ? "warn" : "ok"}
          href="/reports/stock"
          hint="Below reorder level — refill soon"
        />
        <StatCard
          label="Over credit limit"
          value={s.over_limit_count || 0}
          format="number"
          icon={AlertTriangle}
          tone={(s.over_limit_count || 0) > 0 ? "danger" : "ok"}
          href="/reports/accounts?view=receivable"
          hint="Shops exceeding credit — chase first"
        />
        <StatCard
          label="Today expenses"
          value={expenseToday}
          format="money"
          icon={Wallet}
          tone={expenseToday > 0 ? "warn" : "neutral"}
          href="/reports/expenses"
          hint={`Last 7 days: ${formatPkr(weekExpenseTotal)}`}
        />
      </StatsGrid>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="14-day sales trend"
          subtitle="Daily posted sales — spot slow or strong days instantly"
          action={
            <Link href="/reports/sales" className="text-sm font-medium text-[var(--brand)]">
              Reports
            </Link>
          }
        >
          <TrendAreaChart data={salesTrend} valueLabel="Sales" height={260} />
        </ChartCard>

        <ChartCard
          title="Payment mix"
          subtitle="Cash vs credit (last 14 days)"
        >
          <DonutChart
            data={mix}
            centerLabel="Sales mix"
            centerValue={formatPkr(mix.reduce((a, b) => a + b.value, 0))}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Sales vs purchases"
          subtitle="This week — are purchases feeding sales?"
        >
          <CompareBarChart
            data={salesVsPurchases}
            valueLabel="Sales"
            secondaryLabel="Purchases"
            height={240}
          />
        </ChartCard>

        <ChartCard
          title="Recovery momentum"
          subtitle="Cash collected from shops (last 7 days)"
        >
          <TrendAreaChart data={recoveryTrend} valueLabel="Recovery" height={240} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Top cities by sales" subtitle="Where demand is strongest">
          <RankBars data={cityBars} />
        </ChartCard>

        <ChartCard title="Top debtors" subtitle="Highest outstanding balances">
          <div className="space-y-2">
            {debtors.length ? (
              debtors.map((d) => (
                <Link
                  key={d.party_id}
                  href={`/parties/insights/${d.party_id}`}
                  className="panel-list-item"
                >
                  <div>
                    <p className="font-medium">{d.name_en}</p>
                    <p className="text-xs text-[var(--muted)]">{d.party_code}</p>
                  </div>
                  <p className={cn("font-semibold text-rose-700", amountClass)}>
                    {formatPkr(d.balance)}
                  </p>
                </Link>
              ))
            ) : (
              <p className="text-sm text-[var(--muted)]">No receivables yet.</p>
            )}
          </div>
        </ChartCard>

        <ChartCard title="Low stock watch" subtitle="SKUs at or below reorder level">
          <div className="space-y-2">
            {low.length ? (
              low.map((r, idx) => (
                <div key={idx} className="panel-note">
                  <p className="font-medium">
                    {r.product?.code} — {r.product?.name_en}
                  </p>
                  <p className="text-xs text-amber-800">
                    {r.warehouse?.name}: {formatNumber(r.qty, 0)} / reorder{" "}
                    {formatNumber(r.product?.reorder_level || 0, 0)}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-[var(--muted)]">Stock levels look healthy.</p>
            )}
          </div>

          <h3 className="mt-5 text-sm font-semibold">Recent sales</h3>
          <div className="mt-2 space-y-2">
            {(recentSales || []).slice(0, 3).map((inv) => {
              const party = Array.isArray(inv.parties)
                ? inv.parties[0]
                : inv.parties;
              return (
                <Link
                  key={inv.id}
                  href={`/sales/invoices/${inv.id}`}
                  className="panel-list-item"
                >
                  <div>
                    <p className="font-medium">{inv.invoice_no}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {party?.name_en || "—"}
                    </p>
                  </div>
                  <p className={cn("font-semibold", amountClass)}>
                    {formatPkr(inv.grand_total)}
                  </p>
                </Link>
              );
            })}
          </div>
        </ChartCard>
      </div>
    </div>
  );
}

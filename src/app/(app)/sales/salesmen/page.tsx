import { ChartCard } from "@/components/analytics/chart-card";
import {
  CompareBarChart,
  RankBars,
  TrendAreaChart,
} from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { ReportTable } from "@/components/reports/report-table";
import { requireCompanyContext } from "@/lib/auth";
import { one } from "@/lib/reports/helpers";
import { formatPkr } from "@/lib/utils";
import { Receipt, TrendingUp, Users, Wallet } from "lucide-react";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

type SalesmanAgg = {
  id: string;
  name: string;
  bills: number;
  sales: number;
  collected: number;
  credit: number;
};

export default async function SalesmenPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();
  const from = sp.from || monthStart();
  const to = sp.to || today();

  const { data: invoices, error: queryError } = await supabase
    .from("sale_invoices")
    .select(
      "id, invoice_date, payment_type, grand_total, amount_paid, salesman_id, salesman:profiles!sale_invoices_salesman_id_fkey(id, full_name)",
    )
    .eq("company_id", company.id)
    .eq("status", "posted")
    .gte("invoice_date", from)
    .lte("invoice_date", to)
    .order("invoice_date", { ascending: true })
    .limit(5000);

  const list = invoices || [];
  const error = queryError?.message || null;

  // Aggregate per salesman
  const map = new Map<string, SalesmanAgg>();
  for (const inv of list) {
    const sm = one(inv.salesman);
    const id = inv.salesman_id || "unassigned";
    const name = sm?.full_name || "Unassigned";
    const total = Number(inv.grand_total || 0);
    const paid = Number(inv.amount_paid || 0);
    const cur =
      map.get(id) ||
      ({ id, name, bills: 0, sales: 0, collected: 0, credit: 0 } as SalesmanAgg);
    cur.bills += 1;
    cur.sales += total;
    cur.collected += paid;
    cur.credit += total - paid;
    map.set(id, cur);
  }

  const salesmen = [...map.values()].sort((a, b) => b.sales - a.sales);

  const totalSales = salesmen.reduce((s, r) => s + r.sales, 0);
  const totalBills = salesmen.reduce((s, r) => s + r.bills, 0);
  const totalCollected = salesmen.reduce((s, r) => s + r.collected, 0);
  const totalCredit = salesmen.reduce((s, r) => s + r.credit, 0);
  const activeSalesmen = salesmen.filter((r) => r.id !== "unassigned").length;
  const avgBill = totalBills ? totalSales / totalBills : 0;

  // Daily sales trend across the selected range (dates present in the data)
  const byDate = new Map<string, number>();
  for (const inv of list) {
    const d = inv.invoice_date || "";
    if (!d) continue;
    byDate.set(d, (byDate.get(d) || 0) + Number(inv.grand_total || 0));
  }
  const trend = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, v]) => ({ name: d.slice(5), value: v }));

  const topBars = salesmen
    .slice(0, 6)
    .map((r) => ({ name: r.name, value: r.sales }));

  const salesVsCollected = salesmen.slice(0, 8).map((r) => ({
    name: r.name.length > 16 ? `${r.name.slice(0, 15)}…` : r.name,
    value: r.sales,
    secondary: r.collected,
  }));

  const rows = salesmen.map((r) => ({
    Salesman: r.name,
    Bills: r.bills,
    "Sale Amount": r.sales,
    "Cash Collected": r.collected,
    "Credit Outstanding": r.credit,
    "Avg Bill": r.bills ? Math.round(r.sales / r.bills) : 0,
  }));

  return (
    <div className="animate-rise space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          Salesmen Performance
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Sales, collections, and credit by salesman — {company.name}
        </p>
      </div>

      <StatsGrid>
        <StatCard
          label="Total sales"
          value={totalSales}
          format="money"
          icon={TrendingUp}
          tone="brand"
          hint={`${activeSalesmen} salesman${activeSalesmen === 1 ? "" : "en"} with bills`}
        />
        <StatCard
          label="Bills posted"
          value={totalBills}
          format="number"
          icon={Receipt}
          tone="neutral"
          hint={`Avg ${formatPkr(avgBill)} per bill`}
        />
        <StatCard
          label="Cash collected"
          value={totalCollected}
          format="money"
          icon={Wallet}
          tone="ok"
          hint="Paid at or after invoicing"
        />
        <StatCard
          label="Credit outstanding"
          value={totalCredit}
          format="money"
          icon={Users}
          tone={totalCredit > 0 ? "warn" : "ok"}
          href="/reports/aging"
          hint="Unpaid balance from these bills"
        />
      </StatsGrid>

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
        subtitle="Where credit is building up — taller gap means more unpaid"
      >
        <CompareBarChart
          data={salesVsCollected}
          valueLabel="Sales"
          secondaryLabel="Collected"
          height={260}
        />
      </ChartCard>

      <form className="panel grid gap-3 p-4 no-print sm:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
            From
          </label>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
            To
          </label>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            className="h-10 w-full rounded-lg bg-[var(--brand)] px-4 text-sm font-medium text-white"
          >
            Apply period
          </button>
        </div>
      </form>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <ReportTable
        title="Salesman-wise performance"
        companyName={company.name}
        subtitle={`${from} to ${to} · ${salesmen.length} salesman${salesmen.length === 1 ? "" : "en"}`}
        rows={rows}
        filename={`salesmen-performance-${from}-${to}`}
      />
    </div>
  );
}

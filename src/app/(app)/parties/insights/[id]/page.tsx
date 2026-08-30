import { ChartCard } from "@/components/analytics/chart-card";
import { RankBars, TrendAreaChart } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { sumByDay } from "@/lib/analytics/aggregate";
import { requireCompanyContext } from "@/lib/auth";
import { formatNumber, formatPkr } from "@/lib/utils";
import { CreditCard, Phone, Wallet } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function PartyInsightsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, company } = await requireCompanyContext();
  const today = new Date().toISOString().slice(0, 10);

  const { data: party } = await supabase
    .from("parties")
    .select("*")
    .eq("company_id", company.id)
    .eq("id", id)
    .maybeSingle();

  if (!party) notFound();

  const [
    { data: balance },
    { data: sales },
    { data: recoveries },
    { data: topProducts },
  ] = await Promise.all([
    supabase.rpc("get_party_balance", {
      p_company_id: company.id,
      p_party_id: id,
      p_as_of: today,
    }),
    supabase
      .from("sale_invoices")
      .select("id, invoice_no, invoice_date, grand_total, amount_paid, payment_type")
      .eq("company_id", company.id)
      .eq("party_id", id)
      .eq("status", "posted")
      .order("invoice_date", { ascending: false })
      .limit(12),
    supabase
      .from("recoveries")
      .select("id, recovery_date, amount, receipt_no, narration")
      .eq("company_id", company.id)
      .eq("party_id", id)
      .order("recovery_date", { ascending: false })
      .limit(10),
    supabase
      .from("sale_invoice_items")
      .select(
        "product_code, product_name, qty, rate, amount, sale_invoices!inner(company_id, party_id, status)",
      )
      .eq("sale_invoices.company_id", company.id)
      .eq("sale_invoices.party_id", id)
      .eq("sale_invoices.status", "posted")
      .limit(200),
  ]);

  const productMap = new Map<
    string,
    { code: string; name: string; qty: number; amount: number; lastRate: number }
  >();
  for (const row of topProducts || []) {
    const key = row.product_code || row.product_name;
    const prev = productMap.get(key) || {
      code: row.product_code,
      name: row.product_name,
      qty: 0,
      amount: 0,
      lastRate: Number(row.rate || 0),
    };
    prev.qty += Number(row.qty || 0);
    prev.amount += Number(row.amount || 0);
    prev.lastRate = Number(row.rate || 0);
    productMap.set(key, prev);
  }
  const products = [...productMap.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  const bal = Number(balance || 0);
  const creditLimit = Number(party.credit_limit || 0);
  const utilization =
    creditLimit > 0 ? Math.min(100, Math.round((Math.max(bal, 0) / creditLimit) * 100)) : 0;

  return (
    <div className="animate-rise space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand)]">
            Customer intelligence
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold">
            {party.name_en}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {party.party_code} · {[party.city, party.route].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/reports/accounts?view=ledger&party=${party.id}`}
            className="rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium"
          >
            Open ledger
          </Link>
          <Link
            href="/sales/invoices"
            className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white"
          >
            New sale
          </Link>
        </div>
      </div>

      <StatsGrid>
        <StatCard
          label="Balance"
          value={bal}
          format="money"
          icon={Wallet}
          tone={bal > 0 ? "warn" : "ok"}
          hint={bal > 0 ? "Outstanding receivable" : "Clear / credit balance"}
        />
        <StatCard
          label="Credit limit"
          value={creditLimit > 0 ? creditLimit : "Open"}
          format={creditLimit > 0 ? "money" : "text"}
          icon={CreditCard}
          hint="Max allowed outstanding"
        />
        <StatCard
          label="Credit used"
          value={creditLimit > 0 ? `${utilization}%` : "—"}
          tone={
            utilization >= 100 ? "danger" : utilization >= 85 ? "warn" : "brand"
          }
          hint={
            creditLimit > 0
              ? `Used ${formatPkr(Math.max(bal, 0))} of ${formatPkr(creditLimit)}`
              : "No credit limit set"
          }
        />
        <StatCard
          label="Contact"
          value={party.mobile || party.phone || "—"}
          icon={Phone}
          tone="neutral"
          hint={party.contact_person || "No contact person"}
        />
      </StatsGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Sale activity"
          subtitle="Recent invoice totals for this shop"
        >
          <TrendAreaChart
            data={sumByDay(
              (sales || []).map((s) => ({
                date: s.invoice_date,
                amount: Number(s.grand_total || 0),
              })),
              14,
            )}
            valueLabel="Sales"
          />
        </ChartCard>
        <ChartCard title="Top products" subtitle="Preferred buying pattern">
          <RankBars
            data={products.map((p) => ({ name: p.name, value: p.amount }))}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-5">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            Recent sales
          </h2>
          <div className="mt-4 space-y-2">
            {(sales || []).length ? (
              sales!.map((s) => (
                <Link
                  key={s.id}
                  href={`/sales/invoices/${s.id}`}
                  className="flex items-center justify-between rounded-xl border border-[var(--border)] px-3 py-2.5 text-sm"
                >
                  <div>
                    <p className="font-medium">{s.invoice_no}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {s.invoice_date} · {s.payment_type}
                    </p>
                  </div>
                  <p className="font-semibold">{formatPkr(s.grand_total)}</p>
                </Link>
              ))
            ) : (
              <p className="text-sm text-[var(--muted)]">No sales yet.</p>
            )}
          </div>
        </div>

        <div className="panel p-5">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            Recent recoveries
          </h2>
          <div className="mt-4 space-y-2">
            {(recoveries || []).length ? (
              recoveries!.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-xl border border-[var(--border)] px-3 py-2.5 text-sm"
                >
                  <div>
                    <p className="font-medium">{r.receipt_no || "Recovery"}</p>
                    <p className="text-xs text-[var(--muted)]">{r.recovery_date}</p>
                  </div>
                  <p className="font-semibold text-emerald-700">
                    {formatPkr(r.amount)}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-[var(--muted)]">No recoveries yet.</p>
            )}
          </div>
        </div>
      </div>

      <div className="panel p-5">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          Preferred products & last rates
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Smart pricing memory for this shop — rates auto-fill on new sales.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                <th className="py-2">Product</th>
                <th>Qty sold</th>
                <th>Amount</th>
                <th>Last rate</th>
              </tr>
            </thead>
            <tbody>
              {products.length ? (
                products.map((p) => (
                  <tr key={p.code} className="border-t border-[var(--border)]">
                    <td className="py-2.5 font-medium">
                      {p.code} — {p.name}
                    </td>
                    <td>{formatNumber(p.qty, 0)}</td>
                    <td>{formatPkr(p.amount)}</td>
                    <td>{formatPkr(p.lastRate)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="py-6 text-[var(--muted)]">
                    No purchase history yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

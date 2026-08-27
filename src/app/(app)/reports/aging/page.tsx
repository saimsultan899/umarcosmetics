import { ChartCard } from "@/components/analytics/chart-card";
import { CompareBarChart, DonutChart } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { ReportTable } from "@/components/reports/report-table";
import { UrlFilterForm } from "@/components/reports/url-filter-form";
import { requireCompanyContext } from "@/lib/auth";
import { formatPkr } from "@/lib/utils";
import { AlertTriangle, Clock3, Wallet } from "lucide-react";
import Link from "next/link";

type AgingRow = {
  party_id: string;
  party_code: string;
  name_en: string;
  city: string | null;
  route: string | null;
  balance: number;
  bucket_current: number;
  bucket_30: number;
  bucket_60: number;
  bucket_90: number;
  bucket_90_plus: number;
  credit_limit: number;
};

export default async function AgingReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();
  const asOf = sp.date || new Date().toISOString().slice(0, 10);

  const { data } = await supabase.rpc("get_receivable_aging", {
    p_company_id: company.id,
    p_as_of: asOf,
  });

  const rows = (data || []) as AgingRow[];
  const totals = rows.reduce(
    (acc, r) => {
      acc.balance += Number(r.balance || 0);
      acc.b0 += Number(r.bucket_current || 0);
      acc.b30 += Number(r.bucket_30 || 0);
      acc.b60 += Number(r.bucket_60 || 0);
      acc.b90 += Number(r.bucket_90 || 0);
      acc.other += Number(r.bucket_90_plus || 0);
      return acc;
    },
    { balance: 0, b0: 0, b30: 0, b60: 0, b90: 0, other: 0 },
  );

  const exportRows = rows.map((r) => ({
    party_code: r.party_code,
    name_en: r.name_en,
    city: r.city,
    route: r.route,
    balance: Number(r.balance),
    days_0_30: Number(r.bucket_current),
    days_31_60: Number(r.bucket_30),
    days_61_90: Number(r.bucket_60),
    days_90_plus: Number(r.bucket_90),
    other: Number(r.bucket_90_plus),
    credit_limit: Number(r.credit_limit),
  }));

  return (
    <div className="animate-rise space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Receivable aging
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Credit risk by age bucket — know who to chase first ({company.name})
          </p>
        </div>
        <UrlFilterForm className="flex items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--muted)]">As of</span>
            <input
              type="date"
              name="date"
              defaultValue={asOf}
              className="h-10 rounded-lg border border-[var(--border)] px-3"
            />
          </label>
          <button
            type="submit"
            className="h-10 rounded-lg bg-[var(--brand)] px-4 text-sm font-medium text-white"
          >
            Refresh
          </button>
        </UrlFilterForm>
      </div>

      <StatsGrid className="xl:grid-cols-3">
        <StatCard
          label="Total due"
          value={totals.balance}
          format="money"
          icon={Wallet}
          tone="warn"
          hint={`${rows.length} shops with outstanding balance`}
        />
        <StatCard
          label="Fresh (0–30)"
          value={totals.b0}
          format="money"
          icon={Clock3}
          tone="ok"
          hint="Recently billed — normal follow-up"
        />
        <StatCard
          label="Risky (90+)"
          value={totals.b90}
          format="money"
          icon={AlertTriangle}
          tone="danger"
          hint="Oldest dues — chase first"
        />
      </StatsGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Aging mix" subtitle="Where money is stuck by age">
          <DonutChart
            data={[
              { name: "0–30", value: totals.b0 },
              { name: "31–60", value: totals.b30 },
              { name: "61–90", value: totals.b60 },
              { name: "90+", value: totals.b90 },
              { name: "Other", value: totals.other },
            ].filter((x) => x.value > 0)}
            centerValue={formatPkr(totals.balance)}
            centerLabel="Total due"
          />
        </ChartCard>
        <ChartCard
          className="lg:col-span-2"
          title="Bucket comparison"
          subtitle="Larger older bars = more collection pressure"
        >
          <CompareBarChart
            data={[
              { name: "0–30", value: totals.b0 },
              { name: "31–60", value: totals.b30 },
              { name: "61–90", value: totals.b60 },
              { name: "90+", value: totals.b90 },
              { name: "Other", value: totals.other },
            ]}
            valueLabel="Due amount"
          />
        </ChartCard>
      </div>

      <ReportTable
        title="Aging detail"
        companyName={company.name}
        subtitle={`${rows.length} shops with outstanding balance`}
        rows={exportRows}
        filename={`aging-${company.code || company.name}-${asOf}`}
      />

      <div className="panel p-5">
        <h2 className="mb-3 font-[family-name:var(--font-display)] text-lg font-semibold">
          Priority chase list
        </h2>
        <div className="space-y-2">
          {rows.slice(0, 8).map((r) => (
            <Link
              key={r.party_id}
              href={`/parties/insights/${r.party_id}`}
              className="flex items-center justify-between rounded-xl border border-[var(--border)] px-3 py-2.5 text-sm hover:border-[var(--brand)]"
            >
              <div>
                <p className="font-medium">
                  {r.party_code} — {r.name_en}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {[r.city, r.route].filter(Boolean).join(" · ") || "—"} · 90+{" "}
                  {formatPkr(r.bucket_90)}
                </p>
              </div>
              <p className="font-semibold text-rose-700">{formatPkr(r.balance)}</p>
            </Link>
          ))}
          {!rows.length ? (
            <p className="text-sm text-[var(--muted)]">No overdue receivables.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

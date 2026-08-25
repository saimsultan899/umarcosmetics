import { ChartCard } from "@/components/analytics/chart-card";
import { RankBars, TrendAreaChart } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { CreateDialogButton } from "@/components/ui/create-dialog";
import { Select } from "@/components/ui/select";
import { PrintButton } from "@/components/ui/print-button";
import { RecoveryForm } from "@/components/vouchers/recovery-form";
import { lastNDates, sumByDay } from "@/lib/analytics/aggregate";
import { requireCompanyContext } from "@/lib/auth";
import type { Party } from "@/lib/types/database";
import { formatPkr } from "@/lib/utils";
import { one } from "@/lib/reports/helpers";
import { RecoveryOutstandingTable } from "@/components/reports/recovery-outstanding-table";

import { AlertTriangle, Store, Wallet } from "lucide-react";

type RecoveryRow = {
  party_id: string;
  party_code: string;
  name_en: string;
  city: string | null;
  route: string | null;
  balance: number;
  credit_limit: number;
};

function balanceLabel(balance: number) {
  if (Math.abs(balance) < 0.005) return "Nil";
  if (balance > 0) return `${formatPkr(balance)} Dr`;
  return `${formatPkr(Math.abs(balance))} Cr`;
}

export default async function RecoverySheetPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string; route?: string; date?: string }>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();
  const asOf = sp.date || new Date().toISOString().slice(0, 10);

  const from7 = lastNDates(7)[0];
  const [{ data: sheet }, { data: parties }, { data: cities }, { data: recent }, { data: weekRec }] =
    await Promise.all([
      supabase.rpc("get_recovery_sheet", {
        p_company_id: company.id,
        p_as_of: asOf,
        p_city: sp.city || null,
        p_route: sp.route || null,
      }),
      supabase
        .from("parties")
        .select("*")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .in("party_subtype", ["customer", "both"])
        .order("name_en"),
      supabase
        .from("parties")
        .select("city")
        .eq("company_id", company.id)
        .not("city", "is", null),
      supabase
        .from("recoveries")
        .select("*, parties(party_code, name_en)")
        .eq("company_id", company.id)
        .order("recovery_date", { ascending: false })
        .limit(20),
      supabase
        .from("recoveries")
        .select("recovery_date, amount, parties(name_en)")
        .eq("company_id", company.id)
        .gte("recovery_date", from7),
    ]);

  const cityOptions = Array.from(
    new Set((cities || []).map((c) => c.city).filter(Boolean)),
  ) as string[];

  const rows = (sheet || []) as RecoveryRow[];
  const outstanding = rows.filter((r) => Number(r.balance) > 0.005);
  const dueTotal = outstanding.reduce((s, r) => s + Number(r.balance || 0), 0);
  const overLimit = outstanding.filter(
    (r) => Number(r.credit_limit) > 0 && Number(r.balance) > Number(r.credit_limit),
  ).length;
  const weekCollected = (weekRec || []).reduce(
    (s, r) => s + Number(r.amount || 0),
    0,
  );
  const recoveryTrend = sumByDay(
    (weekRec || []).map((r) => ({
      date: r.recovery_date,
      amount: Number(r.amount || 0),
    })),
    7,
  );
  const topDue = outstanding
    .slice()
    .sort((a, b) => Number(b.balance) - Number(a.balance))
    .slice(0, 6)
    .map((r) => ({ name: `${r.party_code} ${r.name_en}`, value: Number(r.balance) }));

  return (
    <div className="animate-rise space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Recovery Sheet
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Shop balances (Dr/Cr) for field collection — {company.name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CreateDialogButton
            label="Record recovery"
            title="Record recovery"
            description="Post collection against a shop balance"
            size="lg"
          >
              <RecoveryForm
                companyId={company.id}
                organizationId={company.organization_id}
                parties={(parties || []) as Party[]}
              />
          </CreateDialogButton>
          <PrintButton label="Print recovery sheet" />
        </div>
      </div>

      <StatsGrid>
        <StatCard
          label="Total due"
          value={dueTotal}
          format="money"
          icon={Wallet}
          tone="warn"
          hint="Outstanding Dr balances to collect"
        />
        <StatCard
          label="Due shops"
          value={outstanding.length}
          format="number"
          icon={Store}
          hint="Shops with balance to recover"
        />
        <StatCard
          label="Collected (7d)"
          value={weekCollected}
          format="money"
          icon={Wallet}
          tone="ok"
          hint="Cash already recovered this week"
        />
        <StatCard
          label="Over credit limit"
          value={overLimit}
          format="number"
          icon={AlertTriangle}
          tone={overLimit > 0 ? "danger" : "ok"}
          href="/reports/aging"
          hint="Priority chase accounts"
        />
      </StatsGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Recovery trend"
          subtitle="Daily collections — last 7 days"
        >
          <TrendAreaChart data={recoveryTrend} valueLabel="Collected" />
        </ChartCard>
        <ChartCard title="Biggest dues" subtitle="Start field visits here">
          <RankBars data={topDue} />
        </ChartCard>
      </div>

      <form className="panel grid gap-3 p-4 sm:grid-cols-4">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
            As of date
          </label>
          <input
            type="date"
            name="date"
            defaultValue={asOf}
            className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
            City
          </label>
          <Select
            name="city"
            defaultValue={sp.city || ""}
            options={[
              { value: "", label: "All cities" },
              ...cityOptions.map((c) => ({ value: c, label: c })),
            ]}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
            Sector
          </label>
          <input
            name="route"
            defaultValue={sp.route || ""}
            placeholder="Optional sector"
            className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            className="h-10 w-full rounded-lg bg-[var(--brand)] px-4 text-sm font-medium text-white"
          >
            Apply filters
          </button>
        </div>
      </form>

      <RecoveryOutstandingTable
        rows={outstanding}
        companyName={company.name}
        asOf={asOf}
        city={sp.city}
        route={sp.route}
      />

      {/* Field recovery sheet — print only (crisp borders + handwriting columns) */}
      <div className="print-only print-sheet report-print report-print--form">
        <div className="report-print-head">
          <div>
            <p className="report-print-title">Recovery Sheet</p>
            <p className="report-print-co">{company.name}</p>
          </div>
          <p className="report-print-meta">
            As of {asOf}
            {sp.city ? ` · ${sp.city}` : ""}
            {sp.route ? ` · ${sp.route}` : ""}
            <br />
            {outstanding.length} shops · Due {formatPkr(dueTotal)}
          </p>
        </div>

        {outstanding.length ? (
          <table>
            <thead>
              <tr>
                <th className="num" style={{ width: "8mm" }}>
                  #
                </th>
                <th>Code</th>
                <th>Shop</th>
                <th>City / Sector</th>
                <th className="num">Balance</th>
                <th className="num">Credit limit</th>
                <th style={{ width: "26mm" }}>Received Rs.</th>
                <th style={{ width: "30mm" }}>Signature / Remarks</th>
              </tr>
            </thead>
            <tbody>
              {outstanding.map((r, i) => (
                <tr key={r.party_id}>
                  <td className="num">{i + 1}</td>
                  <td>{r.party_code}</td>
                  <td>{r.name_en}</td>
                  <td>{[r.city, r.route].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="num">{balanceLabel(Number(r.balance))}</td>
                  <td className="num">
                    {Number(r.credit_limit) > 0 ? formatPkr(r.credit_limit) : "—"}
                  </td>
                  <td />
                  <td />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="num">
                  Total due
                </td>
                <td className="num">{formatPkr(dueTotal)}</td>
                <td />
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
        ) : (
          <p style={{ padding: "16px 0", fontSize: 12 }}>
            No outstanding debit balances for this filter.
          </p>
        )}

        <div className="report-print-foot">
          <span>Salesman: ______________________</span>
          <span>Total cash collected: ______________ · Umar Distribution Software</span>
        </div>
      </div>

      <div className="panel p-5 no-print">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          Recent recoveries
        </h2>
        <div className="mt-3 space-y-2">
          {(recent || []).length ? (
            recent!.map((r) => {
              const party = one(r.parties);
              return (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {party?.party_code} — {party?.name_en}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {r.recovery_date}
                    {r.remarks ? ` · ${r.remarks}` : ""}
                  </p>
                </div>
                <p className="font-semibold text-emerald-700">{formatPkr(r.amount)}</p>
              </div>
              );
            })
          ) : (
            <p className="text-sm text-[var(--muted)]">No recoveries recorded yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

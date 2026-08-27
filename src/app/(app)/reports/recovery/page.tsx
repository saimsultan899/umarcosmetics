import { ChartCard } from "@/components/analytics/chart-card";
import { RankBars, TrendAreaChart } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { RecoverySheet } from "@/components/reports/recovery-sheet";
import { UrlFilterForm } from "@/components/reports/url-filter-form";
import { CreateDialogButton } from "@/components/ui/create-dialog";
import { PrintButton } from "@/components/ui/print-button";
import { Select } from "@/components/ui/select";
import { RecoveryForm } from "@/components/vouchers/recovery-form";
import { lastNDates, sumByDay } from "@/lib/analytics/aggregate";
import { requireCompanyContext } from "@/lib/auth";
import { one } from "@/lib/reports/helpers";
import { buildRecoverySheet, parseScopeToken } from "@/lib/reports/recovery-data";
import type { Party } from "@/lib/types/database";
import { formatPkr } from "@/lib/utils";
import { Layers, Store, Wallet } from "lucide-react";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function distinctSorted(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = (raw || "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export default async function RecoverySheetPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    sector?: string;
    scope?: string;
    party?: string;
  }>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();
  const to = sp.to || today();
  const from = sp.from || monthStart();
  const sector = sp.sector || "";
  const party = sp.party || "";
  const scopeToken = sp.scope || "all";
  const { scope, brand, warehouseId } = parseScopeToken(scopeToken);

  const from7 = lastNDates(7)[0];
  const [sheet, { data: parties }, { data: sectorRows }, { data: recent }, { data: weekRec }] =
    await Promise.all([
      buildRecoverySheet(supabase, {
        companyId: company.id,
        from,
        to,
        sector,
        scope,
        brand,
        warehouseId,
        partyId: party,
        include: "all",
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
        .select("route")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .not("route", "is", null)
        .limit(20000),
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

  const sectorOptions = distinctSorted((sectorRows || []).map((r) => r.route));

  const partyOptions = (parties || []).map((p) => ({
    value: p.id,
    label: `${p.party_code} — ${p.name_en}`,
  }));

  const dueTotal = sheet.grand.dueTotal;
  const dueShops = sheet.flat.filter((r) => Number(r.balance) > 0.005).length;
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
  const topDue = sheet.flat
    .filter((r) => Number(r.balance) > 0.005)
    .slice()
    .sort((a, b) => Number(b.balance) - Number(a.balance))
    .slice(0, 6)
    .map((r) => ({ name: `${r.party_code} ${r.name_en}`, value: Number(r.balance) }));

  const scopeOptions = [
    { value: "all", label: "All parties" },
    ...sheet.warehouseOptions.map((w) => ({
      value: `wh:${w.id}`,
      label: `Warehouse — ${w.name}`,
    })),
    ...sheet.brandOptions.map((b) => ({
      value: `brand:${b}`,
      label: `Brand — ${b}`,
    })),
  ];

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
            description="Add one or more collections, then post them together"
            size="xl"
          >
            <RecoveryForm
              companyId={company.id}
              organizationId={company.organization_id}
              parties={(parties || []) as Party[]}
            />
          </CreateDialogButton>
          <PrintButton label="Print / Download PDF" />
        </div>
      </div>

      <StatsGrid>
        <StatCard
          label="Total due"
          value={dueTotal}
          format="money"
          icon={Wallet}
          tone="warn"
          hint="Outstanding Dr balances in this view"
        />
        <StatCard
          label="Due shops"
          value={dueShops}
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
          label="Sectors"
          value={sheet.sections.length}
          format="number"
          icon={Layers}
          tone="neutral"
          hint="Sector blocks on this sheet"
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

      <UrlFilterForm className="panel no-print grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
            From date
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
            To date
          </label>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
            Sector
          </label>
          <Select
            name="sector"
            defaultValue={sector}
            options={[
              { value: "", label: "All sectors" },
              ...sectorOptions.map((s) => ({ value: s, label: s })),
            ]}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
            Party
          </label>
          <Select
            name="party"
            defaultValue={party}
            placeholder="All parties"
            options={[{ value: "", label: "All parties" }, ...partyOptions]}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
            Scope (brand / warehouse)
          </label>
          <Select name="scope" defaultValue={scopeToken} options={scopeOptions} />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            className="h-10 w-full rounded-lg bg-[var(--brand)] px-4 text-sm font-medium text-white"
          >
            Apply filters
          </button>
        </div>
      </UrlFilterForm>

      <RecoverySheet
        companyName={company.name}
        from={from}
        to={to}
        scopeLabel={sheet.scopeLabel}
        sections={sheet.sections}
        grand={sheet.grand}
      />

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
                  <p className="font-semibold text-emerald-700">
                    {formatPkr(r.amount)}
                  </p>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-[var(--muted)]">
              No recoveries recorded yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

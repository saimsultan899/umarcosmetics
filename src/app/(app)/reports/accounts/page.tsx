import { ChartCard } from "@/components/analytics/chart-card";
import { DonutChart, RankBars } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { ReportTable } from "@/components/reports/report-table";
import { Select } from "@/components/ui/select";
import { requireCompanyContext } from "@/lib/auth";
import { formatPkr } from "@/lib/utils";
import { ArrowDownLeft, ArrowUpRight, Scale } from "lucide-react";
import Link from "next/link";

type BalanceRow = {
  party_id: string;
  party_code: string;
  name_en: string;
  city: string | null;
  route: string | null;
  balance: number;
  credit_limit: number;
};

function signedText(balance: number) {
  if (Math.abs(balance) < 0.005) return "Nil";
  if (balance > 0) return `${formatPkr(balance)} Dr`;
  return `${formatPkr(Math.abs(balance))} Cr`;
}

export default async function AccountsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; party?: string }>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();
  const view = sp.view || "receivable";

  const { data: sheet } = await supabase.rpc("get_recovery_sheet", {
    p_company_id: company.id,
    p_as_of: new Date().toISOString().slice(0, 10),
    p_city: null,
    p_route: null,
  });

  const all = (sheet || []) as BalanceRow[];
  const filtered = all.filter((r) => {
    const bal = Number(r.balance);
    if (view === "receivable") return bal > 0.005;
    if (view === "payable") return bal < -0.005;
    if (view === "all") return true;
    return true;
  });

  const { data: parties } = await supabase
    .from("parties")
    .select("id, party_code, name_en")
    .eq("company_id", company.id)
    .eq("is_active", true)
    .order("name_en");

  let ledgerRows: Record<string, unknown>[] = [];
  const selectedParty = parties?.find((p) => p.id === sp.party);

  if (view === "ledger" && sp.party) {
    const { data: opening } = await supabase
      .from("parties")
      .select("opening_balance")
      .eq("id", sp.party)
      .maybeSingle();

    const { data: ledger } = await supabase
      .from("ledger_entries")
      .select("entry_date, debit, credit, narration, voucher_type")
      .eq("company_id", company.id)
      .eq("party_id", sp.party)
      .order("entry_date", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(500);

    let running = Number(opening?.opening_balance || 0);
    ledgerRows = [
      {
        Date: "",
        Type: "OP",
        Narration: "Opening balance",
        Debit: running > 0 ? running : 0,
        Credit: running < 0 ? Math.abs(running) : 0,
        Balance: signedText(running),
      },
      ...(ledger || []).map((e) => {
        running += Number(e.debit) - Number(e.credit);
        return {
          Date: e.entry_date,
          Type: e.voucher_type || "—",
          Narration: e.narration || "—",
          Debit: Number(e.debit),
          Credit: Number(e.credit),
          Balance: signedText(running),
        };
      }),
    ];
  }

  const receivableTotal = all
    .filter((r) => Number(r.balance) > 0.005)
    .reduce((s, r) => s + Number(r.balance), 0);
  const payableTotal = all
    .filter((r) => Number(r.balance) < -0.005)
    .reduce((s, r) => s + Math.abs(Number(r.balance)), 0);
  const net = receivableTotal - payableTotal;
  const topRecv = all
    .filter((r) => Number(r.balance) > 0.005)
    .sort((a, b) => Number(b.balance) - Number(a.balance))
    .slice(0, 6)
    .map((r) => ({
      name: `${r.party_code} ${r.name_en}`,
      value: Number(r.balance),
    }));
  const positionMix = [
    { name: "Receivable", value: receivableTotal },
    { name: "Payable", value: payableTotal },
  ].filter((x) => x.value > 0);

  const balanceRows = filtered.map((r) => ({
    Code: r.party_code,
    Name: r.name_en,
    City: r.city || "",
    Route: r.route || "",
    Balance: signedText(Number(r.balance)),
    "Balance value": Number(r.balance),
    "Credit limit": Number(r.credit_limit || 0),
    Flag:
      Number(r.credit_limit) > 0 && Number(r.balance) > Number(r.credit_limit)
        ? "Over limit"
        : "",
  }));

  return (
    <div className="animate-rise space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          Accounts Reports
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Receivables, payables, and party ledger — export ready
        </p>
      </div>

      <div className="no-print flex flex-wrap gap-2">
        {[
          ["receivable", "Receivable (Debit)"],
          ["payable", "Payable (Credit)"],
          ["all", "All balances"],
          ["ledger", "Party ledger"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={
              key === "ledger"
                ? `/reports/accounts?view=ledger${sp.party ? `&party=${sp.party}` : ""}`
                : `/reports/accounts?view=${key}`
            }
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              view === key
                ? "bg-[var(--brand)] !text-white"
                : "border border-[var(--border)] bg-white text-[var(--muted)]"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <StatsGrid>
        <StatCard
          label="Receivable"
          value={receivableTotal}
          format="money"
          icon={ArrowUpRight}
          tone="warn"
          href="/reports/accounts?view=receivable"
          hint="Shops owe this to you"
        />
        <StatCard
          label="Payable"
          value={payableTotal}
          format="money"
          icon={ArrowDownLeft}
          href="/reports/accounts?view=payable"
          hint="You owe this to suppliers"
        />
        <StatCard
          label="Net position"
          value={net}
          format="money"
          icon={Scale}
          tone={net >= 0 ? "ok" : "danger"}
          hint={net >= 0 ? "Net positive working capital" : "Payables outweigh receivables"}
        />
        <StatCard
          label="Parties in view"
          value={balanceRows.length}
          format="number"
          tone="neutral"
          hint="Rows matching current filter"
        />
      </StatsGrid>

      {view !== "ledger" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <ChartCard title="AR vs AP" subtitle="Money in vs money out">
            <DonutChart
              data={positionMix}
              centerValue={formatPkr(Math.abs(net))}
              centerLabel="Net"
            />
          </ChartCard>
          <ChartCard
            className="lg:col-span-2"
            title="Top receivables"
            subtitle="Largest shop dues"
          >
            <RankBars data={topRecv} />
          </ChartCard>
        </div>
      ) : null}

      {view === "ledger" ? (
        <div className="space-y-4">
          <form className="panel no-print flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-[260px] flex-1">
              <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
                Party
              </label>
              <Select
                name="party"
                defaultValue={sp.party || ""}
                options={[
                  { value: "", label: "Select party" },
                  ...(parties || []).map((p) => ({
                    value: p.id,
                    label: `${p.party_code} — ${p.name_en}`,
                  })),
                ]}
              />
            </div>
            <input type="hidden" name="view" value="ledger" />
            <button
              type="submit"
              className="h-10 rounded-lg bg-[var(--brand)] px-4 text-sm font-medium text-white"
            >
              Load ledger
            </button>
          </form>

          <ReportTable
            title={`Party Ledger — ${selectedParty ? `${selectedParty.party_code} ${selectedParty.name_en}` : company.name}`}
            companyName={company.name}
            subtitle={selectedParty ? `${ledgerRows.length} lines` : "Select a party"}
            rows={selectedParty ? ledgerRows : []}
            filename={`party-ledger-${sp.party || "none"}`}
          />
        </div>
      ) : (
        <ReportTable
          title={`${view} balances`}
          companyName={company.name}
          subtitle={`${balanceRows.length} parties`}
          rows={balanceRows}
          filename={`accounts-${view}`}
        />
      )}
    </div>
  );
}

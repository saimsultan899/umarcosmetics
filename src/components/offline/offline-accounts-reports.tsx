"use client";

import { ChartCard } from "@/components/analytics/chart-card";
import { DonutChart, RankBars } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { ReportTable } from "@/components/reports/report-table";
import { ReportFilterActions } from "@/components/reports/report-filters";
import { UrlFilterForm } from "@/components/reports/url-filter-form";
import { Select } from "@/components/ui/select";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { offlineAccountsBalances, offlinePartyLedger } from "@/lib/offline/offline-reports";
import { getCachedRows } from "@/lib/offline/local-db";
import { formatPkr } from "@/lib/utils";
import { ArrowDownLeft, ArrowUpRight, Scale } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

function signedText(balance: number) {
  if (Math.abs(balance) < 0.005) return "Nil";
  if (balance > 0) return `${formatPkr(balance)} Dr`;
  return `${formatPkr(Math.abs(balance))} Cr`;
}

export function OfflineAccountsReportsPage({
  companyId,
  companyName,
  searchParams: initialSp,
}: {
  companyId: string;
  companyName: string;
  searchParams?: { view?: string; party?: string };
}) {
  const urlSp = useSearchParams();

  const sp = useMemo(() => {
    return {
      view: urlSp.get("view") ?? initialSp?.view ?? "receivable",
      party: urlSp.get("party") ?? initialSp?.party ?? undefined,
    };
  }, [urlSp, initialSp]);

  const view = sp.view || "receivable";

  const [loading, setLoading] = useState(true);
  const [allBalances, setAllBalances] = useState<
    Array<{
      party_id: string;
      party_code: string;
      name_en: string;
      city: string | null;
      route: string | null;
      balance: number;
      credit_limit: number;
    }>
  >([]);
  const [parties, setParties] = useState<Array<{ id: string; party_code: string; name_en: string }>>([]);
  const [ledgerData, setLedgerData] = useState<{ partyName: string; rows: Record<string, unknown>[] }>({
    partyName: "",
    rows: [],
  });

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      try {
        const [bals, partyRows] = await Promise.all([
          offlineAccountsBalances(companyId),
          getCachedRows("parties", companyId),
        ]);

        if (cancelled) return;
        setAllBalances(bals);
        setParties(
          partyRows.map((p) => ({
            id: String(p.id),
            party_code: String(p.party_code || ""),
            name_en: String(p.name_en || ""),
          })),
        );

        if (view === "ledger" && sp.party) {
          const l = await offlinePartyLedger(companyId, sp.party);
          if (!cancelled) setLedgerData(l);
        }
      } catch (err) {
        console.error("Failed to load local accounts report data:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [companyId, view, sp.party]);

  const filtered = useMemo(() => {
    return allBalances.filter((r) => {
      const bal = Number(r.balance);
      if (view === "receivable") return bal > 0.005;
      if (view === "payable") return bal < -0.005;
      if (view === "all") return true;
      return true;
    });
  }, [allBalances, view]);

  const receivableTotal = useMemo(() => {
    return allBalances
      .filter((r) => Number(r.balance) > 0.005)
      .reduce((s, r) => s + Number(r.balance), 0);
  }, [allBalances]);

  const payableTotal = useMemo(() => {
    return allBalances
      .filter((r) => Number(r.balance) < -0.005)
      .reduce((s, r) => s + Math.abs(Number(r.balance)), 0);
  }, [allBalances]);

  const net = receivableTotal - payableTotal;

  const topRecv = useMemo(() => {
    return allBalances
      .filter((r) => Number(r.balance) > 0.005)
      .sort((a, b) => Number(b.balance) - Number(a.balance))
      .slice(0, 6)
      .map((r) => ({
        name: `${r.party_code} ${r.name_en}`,
        value: Number(r.balance),
      }));
  }, [allBalances]);

  const positionMix = useMemo(() => {
    return [
      { name: "Receivable", value: receivableTotal },
      { name: "Payable", value: payableTotal },
    ].filter((x) => x.value > 0);
  }, [receivableTotal, payableTotal]);

  const balanceRows = useMemo(() => {
    return filtered.map((r) => ({
      Code: r.party_code,
      Name: r.name_en,
      City: r.city || "",
      Sector: r.route || "",
      Balance: signedText(Number(r.balance)),
      "Balance value": Number(r.balance),
      "Credit limit": Number(r.credit_limit || 0),
      Flag:
        Number(r.credit_limit) > 0 && Number(r.balance) > Number(r.credit_limit)
          ? "Over limit"
          : "",
    }));
  }, [filtered]);

  if (loading) {
    return (
      <div className="animate-rise space-y-6">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Accounts Reports
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Receivables, payables, and customer ledger — export ready
          </p>
        </div>
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div className="animate-rise space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          Accounts Reports
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Receivables, payables, and customer ledger — export ready
        </p>
      </div>

      <div className="no-print flex flex-wrap gap-2">
        {[
          ["receivable", "Receivable (Debit)"],
          ["payable", "Payable (Credit)"],
          ["all", "All balances"],
          ["ledger", "Customer ledger"],
          ["salesman", "Salesman ledger"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={
              key === "ledger"
                ? `/reports/accounts?view=ledger${sp.party ? `&party=${sp.party}` : ""}`
                : key === "salesman"
                  ? "/reports/salesman-ledger"
                  : `/reports/accounts?view=${key}`
            }
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              view === key
                ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                : "border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <StatsGrid>
        <StatCard
          label="Total receivable"
          value={receivableTotal}
          format="money"
          icon={ArrowUpRight}
          tone="warn"
          hint="Customers owe"
        />
        <StatCard
          label="Total payable"
          value={payableTotal}
          format="money"
          icon={ArrowDownLeft}
          tone="ok"
          hint="You owe vendors"
        />
        <StatCard
          label="Net balance"
          value={net}
          format="money"
          icon={Scale}
          tone={net >= 0 ? "brand" : "warn"}
          hint={net >= 0 ? "Net asset" : "Net liability"}
        />
      </StatsGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Largest customer balances"
          subtitle="Top customers with outstanding balances"
        >
          <RankBars data={topRecv} />
        </ChartCard>
        <ChartCard title="Receivable vs Payable" subtitle="Balance composition">
          <DonutChart
            data={positionMix}
            centerLabel="Total"
            centerValue={formatPkr(receivableTotal + payableTotal)}
          />
        </ChartCard>
      </div>

      {view === "ledger" ? (
        <>
          <UrlFilterForm
            action="/reports/accounts"
            className="panel no-print flex flex-wrap items-end gap-3 p-4"
          >
            <input type="hidden" name="view" value="ledger" />
            <div className="min-w-64 flex-1">
              <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
                Select customer / vendor
              </label>
              <Select
                name="party"
                defaultValue={sp.party || ""}
                options={[
                  { value: "", label: "— Choose party —" },
                  ...parties.map((p) => ({
                    value: p.id,
                    label: `${p.party_code} — ${p.name_en}`,
                  })),
                ]}
              />
            </div>
            <ReportFilterActions submitLabel="Load ledger" />
          </UrlFilterForm>

          {sp.party ? (
            <ReportTable
              title={`Ledger — ${ledgerData.partyName || "Party"}`}
              companyName={companyName}
              subtitle={`Running ledger with opening balance and running totals`}
              rows={ledgerData.rows}
              filename={`ledger-${sp.party}`}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
              Select a customer or vendor above to load their running account ledger.
            </p>
          )}
        </>
      ) : (
        <ReportTable
          title={
            view === "payable"
              ? "Vendor payables (Credit balances)"
              : view === "all"
                ? "All party balances"
                : "Customer receivables (Debit balances)"
          }
          companyName={companyName}
          subtitle={`${filtered.length} parties · Receivables ${formatPkr(receivableTotal)} · Payables ${formatPkr(payableTotal)}`}
          rows={balanceRows}
          filename={`accounts-${view}`}
        />
      )}
    </div>
  );
}

"use client";

import { ChartCard } from "@/components/analytics/chart-card";
import { RankBars, TrendAreaChart } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { RecoverySheet } from "@/components/reports/recovery-sheet";
import { FilterMultiSelect, ReportFilterActions } from "@/components/reports/report-filters";
import { UrlFilterForm } from "@/components/reports/url-filter-form";
import { CreateDialogButton } from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { PrintButton } from "@/components/ui/print-button";
import { Select } from "@/components/ui/select";
import { RecoveryForm } from "@/components/vouchers/recovery-form";
import { lastNDates } from "@/lib/analytics/aggregate";
import { parseReportList } from "@/lib/reports/filter-params";
import {
  parseScopeToken,
  type RecoveryScope,
  type RecoverySheetResult,
  type RecoverySheetRow,
  type RecoverySheetSection,
} from "@/lib/reports/recovery-data";
import { localDateIso, monthStartLocal } from "@/lib/dates";
import { getCachedRows } from "@/lib/offline/local-db";
import { offlineAccountsBalances } from "@/lib/offline/offline-reports";
import type { Party } from "@/lib/types/database";
import { Layers, Store, Wallet } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

function today() {
  return localDateIso();
}

function monthStart() {
  return monthStartLocal();
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

export function OfflineRecoverySheetPage({
  companyId,
  companyName,
  organizationId,
  searchParams: initialSp,
}: {
  companyId: string;
  companyName: string;
  organizationId?: string;
  searchParams?: {
    from?: string;
    to?: string;
    sector?: string;
    scope?: string;
    party?: string;
  };
}) {
  const urlSp = useSearchParams();

  const sp = useMemo(() => {
    return {
      from: urlSp.get("from") ?? initialSp?.from ?? undefined,
      to: urlSp.get("to") ?? initialSp?.to ?? undefined,
      sector: urlSp.get("sector") ?? initialSp?.sector ?? undefined,
      scope: urlSp.get("scope") ?? initialSp?.scope ?? undefined,
      party: urlSp.get("party") ?? initialSp?.party ?? undefined,
    };
  }, [urlSp, initialSp]);

  const from = sp.from || monthStart();
  const to = sp.to || today();

  const [loading, setLoading] = useState(true);
  const [parties, setParties] = useState<Record<string, unknown>[]>([]);
  const [sales, setSales] = useState<Record<string, unknown>[]>([]);
  const [vouchers, setVouchers] = useState<Record<string, unknown>[]>([]);
  const [salesmen, setSalesmen] = useState<Array<{ id: string; full_name: string }>>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [balances, setBalances] = useState<Array<{ party_id: string; balance: number }>>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      try {
        const {
          hasLocalSqlite,
          localListDocuments,
          localListMaster,
          localListDocumentsByTypes,
        } = await import("@/lib/offline/sqlite-client");

        let pRows: Record<string, unknown>[] = [];
        let sRows: Record<string, unknown>[] = [];
        let vRows: Record<string, unknown>[] = [];
        let smRows: Record<string, unknown>[] = [];
        let wRows: Record<string, unknown>[] = [];

        if (hasLocalSqlite()) {
          const [pRes, sRes, vRes, smRes, wRes] = await Promise.all([
            localListMaster("parties", companyId),
            localListDocuments("sale_invoices", companyId, 2000),
            localListDocumentsByTypes(companyId, [
              "recovery",
              "cash_receipt",
              "receipt",
              "voucher",
            ]),
            localListMaster("salesmen", companyId),
            localListMaster("warehouses", companyId),
          ]);
          pRows = pRes.rows || [];
          sRows = sRes.rows || [];
          vRows = vRes.rows || [];
          smRows = smRes.rows || [];
          wRows = wRes.rows || [];
        }

        const idbSales = await getCachedRows("sale_invoices", companyId);
        if (idbSales.length) {
          const seen = new Set(sRows.map((r) => String(r.id || r._localId || r.invoice_no)));
          for (const row of idbSales) {
            const k = String(row.id || row._localId || row.invoice_no);
            if (!seen.has(k)) {
              sRows.push(row);
              seen.add(k);
            }
          }
        }
        const idbVouchers = await getCachedRows("vouchers", companyId);
        if (idbVouchers.length) {
          const seen = new Set(vRows.map((r) => String(r.id || r._localId || r.voucher_no || r.doc_no)));
          for (const row of idbVouchers) {
            const k = String(row.id || row._localId || row.voucher_no || row.doc_no);
            if (!seen.has(k)) {
              vRows.push(row);
              seen.add(k);
            }
          }
        }
        if (!pRows.length) pRows = await getCachedRows("parties", companyId);
        if (!smRows.length) smRows = await getCachedRows("salesmen", companyId);
        if (!wRows.length) wRows = await getCachedRows("warehouses", companyId);

        const balRows = await offlineAccountsBalances(companyId);

        if (cancelled) return;
        setParties(pRows);
        setSales(sRows);
        setVouchers(vRows);
        setSalesmen(smRows as Array<{ id: string; full_name: string }>);
        setWarehouses(wRows as Array<{ id: string; name: string }>);
        setBalances(balRows);
      } catch (err) {
        console.error("Failed to load local recovery data:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const sectors = parseReportList(sp.sector);
  const partyIds = parseReportList(sp.party);
  const scopeToken = sp.scope || "all";
  const { scope, warehouseId } = parseScopeToken(scopeToken);

  const townLabel =
    sectors.length === 0
      ? "All Towns"
      : sectors.length === 1
        ? sectors[0]
        : `${sectors.length} sectors`;

  const sectorOptions = useMemo(() => {
    return distinctSorted(
      parties.map((p) => (p.route ? String(p.route) : null)),
    );
  }, [parties]);

  const partyOptions = useMemo(() => {
    return parties
      .filter((p) => {
        const sub = String(p.party_subtype || p.party_type || "").toLowerCase();
        return sub === "customer" || sub === "both" || !sub;
      })
      .map((p) => ({
        value: String(p.id),
        label: `${p.party_code} — ${p.name_en}`,
      }));
  }, [parties]);

  // Balance map
  const balanceMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of balances) {
      map.set(b.party_id, b.balance);
    }
    return map;
  }, [balances]);

  // Build sheet
  const sheet: RecoverySheetResult = useMemo(() => {
    const lastSaleByParty = new Map<
      string,
      { id: string; date: string; grand_total: number }
    >();
    for (const s of sales) {
      if (s.status === "voided" || s.status === "cancelled") continue;
      const pid = String(s.party_id || "");
      if (!pid) continue;
      const d = String(s.invoice_date || "");
      if (d > to) continue;
      const cur = lastSaleByParty.get(pid);
      if (!cur || d > cur.date) {
        lastSaleByParty.set(pid, {
          id: String(s.id || ""),
          date: d,
          grand_total: Number(s.grand_total || 0),
        });
      }
    }

    const lastRecoveryByParty = new Map<string, { date: string; amount: number }>();
    for (const v of vouchers) {
      const type = String(v.voucher_type || v.type || v.entity_type || "");
      const isRec =
        type === "cash_receipt" || type === "recovery" || type === "receipt";
      if (!isRec) continue;
      const pid = String(v.party_id || "");
      if (!pid) continue;
      const d = String(v.voucher_date || v.doc_date || "");
      if (d > to) continue;
      const cur = lastRecoveryByParty.get(pid);
      if (!cur || d > cur.date) {
        lastRecoveryByParty.set(pid, {
          date: d,
          amount: Number(v.amount ?? v.total_amount ?? v.grand_total ?? 0),
        });
      }
    }

    const customerParties = parties.filter((p) => {
      const sub = String(p.party_subtype || p.party_type || "").toLowerCase();
      const isCust = sub === "customer" || sub === "both" || !sub;
      if (!isCust) return false;
      if (sectors.length && !sectors.includes(String(p.route || ""))) return false;
      if (partyIds.length && !partyIds.includes(String(p.id))) return false;
      return true;
    });

    const flat: RecoverySheetRow[] = customerParties.map((p) => {
      const partyId = String(p.id);
      const balance = balanceMap.get(partyId) ?? 0;
      const last = lastSaleByParty.get(partyId);
      const lastRec = lastRecoveryByParty.get(partyId);

      const saleIsOpen =
        !lastRec || (last && last.date >= lastRec.date);
      const lastSaleValue = saleIsOpen && last ? last.grand_total : null;
      const prevBal =
        lastSaleValue != null ? balance - lastSaleValue : balance;

      return {
        party_id: partyId,
        party_code: String(p.party_code || ""),
        name_en: String(p.name_en || ""),
        city: p.city ? String(p.city) : null,
        route: p.route ? String(p.route) : null,
        balance,
        prev_balance: prevBal,
        last_sale_id: saleIsOpen && last ? last.id : null,
        last_sale_date: saleIsOpen && last ? last.date : null,
        last_sale_value: lastSaleValue,
        final_balance: balance,
        head: p.head ? String(p.head) : null,
        last_received_amount: lastRec ? lastRec.amount : null,
      };
    });

    const groups = new Map<string, RecoverySheetRow[]>();
    for (const row of flat) {
      const sec = row.route || "No sector";
      const list = groups.get(sec) || [];
      list.push(row);
      groups.set(sec, list);
    }

    const sortedSectors = [...groups.keys()].sort((a, b) =>
      a.localeCompare(b),
    );

    const sections: RecoverySheetSection[] = [];
    let dueTotal = 0;
    let crTotal = 0;
    let netTotal = 0;

    for (const sec of sortedSectors) {
      const secRows = groups.get(sec) || [];
      secRows.sort((a, b) => a.name_en.localeCompare(b.name_en));

      let secDue = 0;
      let secCr = 0;
      let secNet = 0;
      for (const r of secRows) {
        if (r.balance > 0.005) secDue += r.balance;
        else if (r.balance < -0.005) secCr += Math.abs(r.balance);
        secNet += r.balance;
      }
      dueTotal += secDue;
      crTotal += secCr;
      netTotal += secNet;

      sections.push({
        sector: sec,
        rows: secRows,
        count: secRows.length,
        dueTotal: secDue,
        crTotal: secCr,
        netTotal: secNet,
      });
    }

    let scopeLabel = "All customers";
    if (scope === "warehouse" && warehouseId) {
      const wh = warehouses.find((w) => w.id === warehouseId);
      scopeLabel = `Company — ${wh?.name || "Selected"}`;
    }

    return {
      sections,
      flat,
      grand: { count: flat.length, dueTotal, crTotal, netTotal },
      scopeLabel,
      brandOptions: [],
      warehouseOptions: warehouses,
    };
  }, [parties, sales, vouchers, balanceMap, sectors, partyIds, scope, warehouseId, warehouses, to]);

  const dueTotal = sheet.grand.dueTotal;
  const dueShops = sheet.flat.filter((r) => Number(r.balance) > 0.005).length;

  const past7 = lastNDates(7);
  const weekRecMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of past7) map.set(d, 0);

    for (const v of vouchers) {
      const type = String(v.voucher_type || v.type || v.entity_type || "");
      const isRec =
        type === "cash_receipt" || type === "recovery" || type === "receipt";
      if (!isRec) continue;
      const d = String(v.voucher_date || v.doc_date || "").slice(0, 10);
      if (map.has(d)) {
        map.set(d, (map.get(d) || 0) + Number(v.amount ?? v.total_amount ?? v.grand_total ?? 0));
      }
    }
    return map;
  }, [vouchers, past7]);

  const weekCollected = useMemo(() => {
    let sum = 0;
    for (const v of weekRecMap.values()) sum += v;
    return sum;
  }, [weekRecMap]);

  const recoveryTrend = useMemo(() => {
    return past7.map((date) => ({
      name: date,
      value: weekRecMap.get(date) || 0,
    }));
  }, [past7, weekRecMap]);

  const topDue = useMemo(() => {
    return [...sheet.flat]
      .filter((r) => r.balance > 0.005)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 5)
      .map((r) => ({
        name: `${r.name_en} (${r.party_code})`,
        value: r.balance,
      }));
  }, [sheet.flat]);

  if (loading) {
    return (
      <div className="animate-rise space-y-6">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Customer Receivables / Recovery Sheet
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Printable recovery sheet grouped by sector with collection entry
          </p>
        </div>
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div className="animate-rise space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Customer Receivables / Recovery Sheet
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {from} → {to} · {townLabel} · {sheet.scopeLabel}
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
              companyId={companyId}
              organizationId={organizationId || companyId}
              parties={parties as Party[]}
              salesmen={salesmen.map((s) => ({
                id: s.id,
                full_name: s.full_name,
                user_id: (s as unknown as { user_id?: string }).user_id || s.id,
              }))}
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

        <FilterMultiSelect
          name="sector"
          label="Town / Sector"
          value={sp.sector}
          options={sectorOptions.map((s) => ({ value: s, label: s }))}
        />
        <FilterMultiSelect
          name="party"
          label="Customer"
          value={sp.party}
          options={partyOptions}
        />

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
            Customer scope
          </label>
          <Select
            name="scope"
            defaultValue={scopeToken}
            options={[
              { value: "all", label: "All customers (all company dues)" },
              ...sheet.warehouseOptions.map((w) => ({
                value: `wh:${w.id}`,
                label: `Company — ${w.name}`,
              })),
            ]}
          />
        </div>

        <ReportFilterActions submitLabel="Run report" />
      </UrlFilterForm>

      <RecoverySheet
        companyName={companyName}
        from={from}
        to={to}
        scopeLabel={sheet.scopeLabel}
        townLabel={townLabel}
        sections={sheet.sections}
        grand={sheet.grand}
      />
    </div>
  );
}

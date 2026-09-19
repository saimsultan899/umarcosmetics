"use client";

import { ChartCard } from "@/components/analytics/chart-card";
import { DonutChart, RankBars, TrendAreaChart } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { FilterMultiSelect, ReportFilters } from "@/components/reports/report-filters";
import { ReportTable } from "@/components/reports/report-table";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { EXPENSE_CATEGORIES, expenseCategoryLabel } from "@/lib/expenses/categories";
import { parseReportList } from "@/lib/reports/filter-params";
import { localDateIso, monthStartLocal } from "@/lib/dates";
import { getCachedRows } from "@/lib/offline/local-db";
import { formatReportInvNo } from "@/lib/reports/helpers";
import { formatPkr } from "@/lib/utils";
import { Banknote, Receipt, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

function today() {
  return localDateIso();
}

function monthStart() {
  return monthStartLocal();
}

export function OfflineExpenseReportsPage({
  companyId,
  companyName,
  searchParams: initialSp,
}: {
  companyId: string;
  companyName: string;
  searchParams?: {
    from?: string;
    to?: string;
    category?: string;
    salesman?: string;
  };
}) {
  const urlSp = useSearchParams();

  const sp = useMemo(() => {
    return {
      from: urlSp.get("from") ?? initialSp?.from ?? undefined,
      to: urlSp.get("to") ?? initialSp?.to ?? undefined,
      category: urlSp.get("category") ?? initialSp?.category ?? undefined,
      salesman: urlSp.get("salesman") ?? initialSp?.salesman ?? undefined,
    };
  }, [urlSp, initialSp]);

  const from = sp.from || monthStart();
  const to = sp.to || today();

  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState<Record<string, unknown>[]>([]);
  const [salesmen, setSalesmen] = useState<Array<{ id: string; full_name: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      try {
        const {
          hasLocalSqlite,
          localListByEntity,
          localListMaster,
        } = await import("@/lib/offline/sqlite-client");

        let expRows: Record<string, unknown>[] = [];
        let smRows: Record<string, unknown>[] = [];

        if (hasLocalSqlite()) {
          const [expRes, smRes] = await Promise.all([
            localListByEntity(companyId, "expense", 2000),
            localListMaster("salesmen", companyId),
          ]);
          expRows = expRes.rows || [];
          smRows = smRes.rows || [];
        }

        const idbExp = await getCachedRows("expenses", companyId);
        if (idbExp.length) {
          const seen = new Set(expRows.map((r) => String(r.id || r._localId || r.expense_no || r.doc_no)));
          for (const row of idbExp) {
            const k = String(row.id || row._localId || row.expense_no || row.doc_no);
            if (!seen.has(k)) {
              expRows.push(row);
              seen.add(k);
            }
          }
        }
        if (!smRows.length) smRows = await getCachedRows("salesmen", companyId);

        if (cancelled) return;
        setExpenses(expRows);
        setSalesmen(smRows as Array<{ id: string; full_name: string }>);
      } catch (err) {
        console.error("Failed to load local expense data:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const categories = parseReportList(sp.category);
  const salesmanIds = parseReportList(sp.salesman);

  const smMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of salesmen) {
      if (s.id) map.set(String(s.id), String(s.full_name || "Salesman"));
    }
    return map;
  }, [salesmen]);

  const filtered = useMemo(() => {
    return expenses.filter((r) => {
      const d = String(r.expense_date || r.doc_date || "").slice(0, 10);
      if (d < from || d > to) return false;
      const cat = String(r.category || "");
      if (categories.length && !categories.includes(cat)) return false;

      const smId = r.salesman_id ? String(r.salesman_id) : "unassigned";
      if (salesmanIds.length) {
        if (!salesmanIds.includes(smId)) return false;
      }

      return true;
    });
  }, [expenses, from, to, categories, salesmanIds]);

  const totals = useMemo(() => {
    let amount = 0;
    let salary = 0;
    let other = 0;
    for (const r of filtered) {
      const a = Number(r.amount ?? r.total_amount ?? 0);
      amount += a;
      if (r.category === "salary") salary += a;
      else other += a;
    }
    return { count: filtered.length, amount, salary, other };
  }, [filtered]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      const cat = String(r.category || "other");
      const a = Number(r.amount ?? r.total_amount ?? 0);
      map.set(cat, (map.get(cat) || 0) + a);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cat, val]) => ({
        name: expenseCategoryLabel(cat),
        value: val,
      }));
  }, [filtered]);

  const bySalesman = useMemo(() => {
    const map = new Map<string, { name: string; total: number; salary: number; other: number }>();
    for (const r of filtered) {
      const smId = r.salesman_id ? String(r.salesman_id) : "unassigned";
      const name = smId === "unassigned" ? "General / Unassigned" : (smMap.get(smId) || "Salesman");
      const a = Number(r.amount ?? r.total_amount ?? 0);
      const cur = map.get(smId) || { name, total: 0, salary: 0, other: 0 };
      cur.total += a;
      if (r.category === "salary") cur.salary += a;
      else cur.other += a;
      map.set(smId, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [filtered, smMap]);

  const trend = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      const d = String(r.expense_date || r.doc_date || "").slice(0, 10);
      map.set(d, (map.get(d) || 0) + Number(r.amount ?? r.total_amount ?? 0));
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, value]) => ({ name, value }));
  }, [filtered]);

  const rows = useMemo(() => {
    return filtered.map((r) => {
      const smId = r.salesman_id ? String(r.salesman_id) : null;
      const smName = smId ? smMap.get(smId) || "Salesman" : "—";
      const rawNo = String(r.expense_no || r.doc_no || "");
      const expNo = formatReportInvNo(rawNo) || rawNo || "—";
      return {
        "Expense #": expNo,
        Date: r.expense_date || r.doc_date || "",
        Category: expenseCategoryLabel(String(r.category || "")),
        Amount: Number(r.amount ?? r.total_amount ?? 0),
        Salesman: smName,
        Remarks: r.remarks || "",
        _href: r.id ? `/vouchers/expenses/${r.id}` : "",
      };
    });
  }, [filtered, smMap]);

  if (loading) {
    return (
      <div className="animate-rise space-y-6">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Expense Reports
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Operating expenses, salaries, fuel, bills, and other daily costs
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
            Expense Reports
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Operating expenses, salaries, fuel, bills, and other daily costs
          </p>
        </div>
        <Link
          href="/vouchers/expenses"
          className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-95"
        >
          + Add expense
        </Link>
      </div>

      <StatsGrid>
        <StatCard
          label="Total expenses"
          value={totals.amount}
          format="money"
          icon={Wallet}
          tone="warn"
          hint={`${totals.count} entries`}
        />
        <StatCard
          label="Salesman salary"
          value={totals.salary}
          format="money"
          icon={Users}
          href="/vouchers/expenses"
          hint="Paid to field staff"
        />
        <StatCard
          label="Other daily costs"
          value={totals.other}
          format="money"
          icon={Receipt}
          hint="Fuel, food, rent, bills, other"
        />
        <StatCard
          label="Salary share"
          value={totals.amount ? Math.round((totals.salary / totals.amount) * 100) : 0}
          format="number"
          icon={Banknote}
          hint="% of expenses that are salary"
        />
      </StatsGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Expense mix" subtitle="By type in this period">
          <DonutChart
            data={byCategory}
            centerLabel="Spent"
            centerValue={formatPkr(totals.amount)}
          />
        </ChartCard>
        <ChartCard
          className="lg:col-span-2"
          title="Daily spend"
          subtitle={`${from} to ${to}`}
        >
          <TrendAreaChart data={trend} valueLabel="Expense" />
        </ChartCard>
      </div>

      <ChartCard title="Who the cost belongs to" subtitle="Salary + tagged daily costs">
        <RankBars
          data={bySalesman.slice(0, 8).map((r) => ({
            name: r.name,
            value: r.total,
          }))}
        />
      </ChartCard>

      <ReportFilters
        action="/reports/expenses"
        defaults={{ from, to }}
        extras={
          <>
            <FilterMultiSelect
              name="category"
              label="Type"
              value={sp.category}
              allLabel="All types"
              options={EXPENSE_CATEGORIES.map((c) => ({
                value: c.value,
                label: c.label,
              }))}
            />
            <FilterMultiSelect
              name="salesman"
              label="Staff / Salesman"
              value={sp.salesman}
              allLabel="All staff & general"
              options={[
                { value: "unassigned", label: "— General / Unassigned —" },
                ...salesmen.map((s) => ({
                  value: s.id,
                  label: s.full_name,
                })),
              ]}
            />
          </>
        }
      />

      {byCategory.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {byCategory.map((c) => (
            <div
              key={c.name}
              className="panel flex items-center justify-between p-3.5"
            >
              <div>
                <p className="text-xs uppercase text-[var(--muted)]">{c.name}</p>
                <p className="mt-1 font-semibold">{formatPkr(c.value)}</p>
              </div>
              <span className="text-xs text-[var(--muted)]">
                {totals.amount
                  ? `${Math.round((c.value / totals.amount) * 100)}%`
                  : "0%"}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <ReportTable
        title="Expense report"
        companyName={companyName}
        subtitle={`${from} to ${to} · ${rows.length} rows`}
        rows={rows}
        filename={`expenses-${from}-${to}`}
      />
    </div>
  );
}

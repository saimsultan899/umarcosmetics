"use client";

import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { ReportSectionHead } from "@/components/reports/report-section-head";
import { ReportTable } from "@/components/reports/report-table";
import { Button } from "@/components/ui/button";
import type { SalesmanLedgerLine } from "@/lib/reports/salesman-ledger";
import { formatPkr } from "@/lib/utils";
import { HandCoins, Receipt, ShoppingCart, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const ENTRY_TYPES = ["Sale", "Recovery", "Salary", "Expense"] as const;

const controlClass =
  "h-10 rounded-lg border border-[var(--border)] bg-white px-2 text-sm";

export function SalesmanLedgerView({
  companyName,
  from,
  to,
  salesmanId,
  salesmanName,
  salesmen,
  lines,
  totals,
  error,
}: {
  companyName: string;
  from: string;
  to: string;
  salesmanId: string;
  salesmanName: string;
  salesmen: { id: string; name: string }[];
  lines: SalesmanLedgerLine[];
  totals: {
    sales: number;
    collected: number;
    salary: number;
    otherExpenses: number;
    expenses: number;
    netCash: number;
  };
  error: string | null;
}) {
  const router = useRouter();
  const [entryType, setEntryType] = useState("");
  const shown = useMemo(
    () => (entryType ? lines.filter((line) => line.type === entryType) : lines),
    [lines, entryType],
  );

  function clearFilters(event: React.MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    setEntryType("");
    const params = new URLSearchParams();
    const fromEl = form?.elements.namedItem("from");
    const toEl = form?.elements.namedItem("to");
    const fromValue = fromEl instanceof HTMLInputElement ? fromEl.value : from;
    const toValue = toEl instanceof HTMLInputElement ? toEl.value : to;
    if (fromValue) params.set("from", fromValue);
    if (toValue) params.set("to", toValue);
    const qs = params.toString();
    router.push(qs ? `/reports/salesman-ledger?${qs}` : "/reports/salesman-ledger");
  }

  return (
    <div className="animate-rise space-y-6">
      <ReportSectionHead
        size="page"
        title="Salesman ledger"
        subtitle={`Running book of this salesman's sales, recoveries, salary, and tagged daily expenses — ${companyName}`}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            <Link
              href="/vouchers/expenses"
              className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium"
            >
              Add salary / expense
            </Link>
            <Link
              href="/reports/accounts?view=ledger"
              className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium"
            >
              Customer ledger
            </Link>
          </div>
        }
      />

      <StatsGrid>
        <StatCard
          label="Sales"
          value={totals.sales}
          format="money"
          icon={ShoppingCart}
          hint={salesmanId ? "Bills tagged to this salesman" : "Choose a salesman below"}
        />
        <StatCard
          label="Cash collected"
          value={totals.collected}
          format="money"
          icon={HandCoins}
          tone="ok"
          hint="Invoice cash + recoveries"
        />
        <StatCard
          label="Salary + expenses"
          value={totals.expenses}
          format="money"
          icon={Receipt}
          tone="warn"
          hint={`${formatPkr(totals.salary)} salary · ${formatPkr(totals.otherExpenses)} other`}
        />
        <StatCard
          label="Net cash"
          value={totals.netCash}
          format="money"
          icon={Wallet}
          tone={totals.netCash >= 0 ? "ok" : "danger"}
          hint="Collected minus salary & expenses"
        />
      </StatsGrid>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <ReportTable
        title={
          salesmanId
            ? `Salesman ledger — ${salesmanName}`
            : "Salesman ledger"
        }
        companyName={companyName}
        subtitle={
          salesmanId
            ? `${from} to ${to}${entryType ? ` · ${entryType}` : ""} · ${shown.length} lines`
            : "Choose a salesman in the filters to open his running ledger"
        }
        singleLineFilters
        filters={
          <form
            action="/reports/salesman-ledger"
            className="flex flex-nowrap items-center gap-2"
          >
            <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              From
              <input
                type="date"
                name="from"
                defaultValue={from}
                className={controlClass}
              />
            </label>
            <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              To
              <input
                type="date"
                name="to"
                defaultValue={to}
                className={controlClass}
              />
            </label>
            <select
              name="salesman"
              defaultValue={salesmanId}
              aria-label="Salesman"
              className={`${controlClass} min-w-[11rem]`}
            >
              <option value="">Select salesman</option>
              {salesmen.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Type"
              value={entryType}
              onChange={(e) => setEntryType(e.target.value)}
              className={`${controlClass} min-w-[8.5rem]`}
            >
              <option value="">All types</option>
              {ENTRY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <Button type="submit" className="h-10 shrink-0 whitespace-nowrap px-4">
              Run report
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={clearFilters}
              className="h-10 shrink-0 whitespace-nowrap px-4"
            >
              Clear filter
            </Button>
          </form>
        }
        rows={shown.map((l) => ({
          Date: l.date,
          Type: l.type,
          Particulars: l.particulars,
          "Sale amount": l.sales,
          "Cash collected": l.collected,
          "Expense paid": l.expense,
          "Running cash": l.running,
          ...(l.docTable && l.docId
            ? {
                _doc_table: l.docTable,
                _doc_id: l.docId,
                _doc_title: l.docTitle || l.particulars,
                _href:
                  l.docTable === "sale_invoices"
                    ? `/sales/invoices/${l.docId}`
                    : "",
              }
            : {}),
        }))}
        filename={`salesman-ledger-${salesmanId || "all"}-${from}-${to}`}
      />
    </div>
  );
}

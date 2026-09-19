"use client";

import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { PageHeading } from "@/components/ui/create-dialog";
import { ReportTable } from "@/components/reports/report-table";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import {
  offlineAccountsBalances,
  offlineExpensesSummary,
  offlineExpirySummary,
  offlinePartyLedger,
  offlinePartiesOptions,
  offlineProfitSummary,
  offlinePurchasesSummary,
  offlineReceivableAging,
  offlineRecoverySummary,
  offlineSalesmanLedger,
  offlineSalesmenOptions,
  offlineSalesSummary,
  offlineStockSnapshot,
} from "@/lib/offline/offline-reports";
import { formatPkr } from "@/lib/utils";
import { FileSpreadsheet, Rows3 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type ReportKind =
  | "sales"
  | "purchases"
  | "recovery"
  | "stock"
  | "expenses"
  | "expiry"
  | "accounts"
  | "aging"
  | "profit"
  | "salesman_ledger";

const TITLES: Record<ReportKind, { title: string; description: string }> = {
  sales: {
    title: "Sale Reports",
    description: "Filtered sales analytics with print / Excel / PDF export",
  },
  purchases: {
    title: "Purchase Reports",
    description: "Vendor and item purchase analytics with export",
  },
  recovery: {
    title: "Customer Receivables / Recovery Sheet",
    description: "Printable recovery sheet grouped by sector with collection entry",
  },
  stock: {
    title: "Stock Reports",
    description: "Product stock balances, movements, and reorder levels",
  },
  expenses: {
    title: "Expense Reports",
    description: "Operating expenses and overhead analytics",
  },
  expiry: {
    title: "Expiry Reports",
    description: "Expiry receipts and vendor claims",
  },
  accounts: {
    title: "Accounts Reports",
    description: "Customer and vendor balance ledger",
  },
  aging: {
    title: "Receivable Aging",
    description: "Aging analysis of outstanding customer invoices",
  },
  profit: {
    title: "Profit Summary",
    description: "Estimated gross and net profit summary",
  },
  salesman_ledger: {
    title: "Salesman Ledger",
    description: "Running ledger and cash collection tracking by salesman",
  },
};

function signedText(balance: number) {
  if (Math.abs(balance) < 0.005) return "Nil";
  if (balance > 0) return `${formatPkr(balance)} Dr`;
  return `${formatPkr(Math.abs(balance))} Cr`;
}

/** Same report chrome as online — ReportTable + stats — local data. */
export function OfflineReportPanel({
  kind,
  companyId,
  companyName,
  from,
  to,
  view,
  partyId,
  salesmanId,
  asOf,
}: {
  kind: ReportKind;
  companyId: string;
  companyName?: string;
  from?: string | null;
  to?: string | null;
  view?: string | null;
  partyId?: string | null;
  salesmanId?: string | null;
  asOf?: string | null;
}) {
  const meta = TITLES[kind];
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [secondTotal, setSecondTotal] = useState<number | null>(null);
  const [secondLabel, setSecondLabel] = useState("Total");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [subtitle, setSubtitle] = useState("");
  const [parties, setParties] = useState<
    Array<{ id: string; party_code: string; name_en: string }>
  >([]);
  const [salesmen, setSalesmen] = useState<
    Array<{ id: string; user_id: string; full_name: string }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setSecondTotal(null);
      try {
        const filters = { companyId, from, to };
        if (kind === "sales") {
          const s = await offlineSalesSummary(filters);
          if (cancelled) return;
          setCount(s.count);
          setTotal(s.total);
          setRows(
            s.rows.map((r) => ({
              Invoice: r.invoice_no || r.id,
              Date: r.invoice_date,
              Party: r.party_name || "",
              Payment: r.payment_type || "",
              Total: Number(r.grand_total) || 0,
            })),
          );
        } else if (kind === "purchases") {
          const s = await offlinePurchasesSummary(filters);
          if (cancelled) return;
          setCount(s.count);
          setTotal(s.total);
          setRows(
            s.rows.map((r) => ({
              Invoice: r.invoice_no || r.id,
              Date: r.invoice_date,
              Party: r.party_name || "",
              Total: Number(r.grand_total) || 0,
            })),
          );
        } else if (kind === "recovery") {
          const s = await offlineRecoverySummary(filters);
          if (cancelled) return;
          setCount(s.count);
          setTotal(s.total);
          setRows(
            s.rows.map((r) => ({
              Voucher: r.voucher_no || r.doc_no || r.id,
              Date: r.voucher_date || r.doc_date || "",
              Party: r.party_name || "",
              Amount: Number(r.amount ?? r.total_amount ?? r.grand_total) || 0,
            })),
          );
        } else if (kind === "stock") {
          const s = await offlineStockSnapshot(companyId);
          if (cancelled) return;
          setCount(s.length);
          setTotal(0);
          setRows(
            s.map((r) => {
              const products = r.products as
                | { code?: string; name_en?: string }
                | undefined;
              return {
                Product: products?.code || r.product_id,
                Name: products?.name_en || "",
                Warehouse: r.warehouse_id,
                Qty: r.qty,
                Adjusted: r._offlineAdjusted ? "Yes" : "",
              };
            }),
          );
        } else if (kind === "expenses") {
          const s = await offlineExpensesSummary(filters);
          if (cancelled) return;
          setCount(s.count);
          setTotal(s.total);
          setRows(
            s.rows.map((r) => ({
              Date: r.expense_date || r.doc_date || "",
              Category: r.category || "Expense",
              Amount: Number(r.amount ?? r.total_amount) || 0,
              Remarks: r.remarks || "",
            })),
          );
        } else if (kind === "expiry") {
          const s = await offlineExpirySummary(filters);
          if (cancelled) return;
          const combined = [
            ...s.receipts.map((r) => ({
              Type: "Receipt",
              Doc: r.receipt_no || r.doc_no || r.id,
              Date: r.receipt_date || r.doc_date || "",
              Amount: Number(r.grand_total ?? r.amount) || 0,
            })),
            ...s.claims.map((r) => ({
              Type: "Claim",
              Doc: r.claim_no || r.doc_no || r.id,
              Date: r.claim_date || r.doc_date || "",
              Amount: Number(r.grand_total ?? r.amount) || 0,
            })),
          ];
          setCount(combined.length);
          setTotal(combined.reduce((a, b) => a + Number(b.Amount || 0), 0));
          setRows(combined);
        } else if (kind === "accounts") {
          const opts = await offlinePartiesOptions(companyId);
          if (cancelled) return;
          setParties(opts);
          const activeView = view || "receivable";
          if (activeView === "ledger" && partyId) {
            const ledger = await offlinePartyLedger(companyId, partyId);
            if (cancelled) return;
            setCount(ledger.rows.length);
            setTotal(0);
            setRows(ledger.rows);
            setSubtitle(`Ledger · ${ledger.partyName}`);
          } else {
            const all = await offlineAccountsBalances(companyId);
            if (cancelled) return;
            const filtered = all.filter((r) => {
              if (activeView === "receivable") return r.balance > 0.005;
              if (activeView === "payable") return r.balance < -0.005;
              return true;
            });
            const recv = all
              .filter((r) => r.balance > 0.005)
              .reduce((s, r) => s + r.balance, 0);
            const pay = all
              .filter((r) => r.balance < -0.005)
              .reduce((s, r) => s + Math.abs(r.balance), 0);
            setCount(filtered.length);
            setTotal(recv);
            setSecondTotal(pay);
            setSecondLabel("Payable");
            setSubtitle(
              activeView === "payable"
                ? "Vendors with credit balance"
                : activeView === "all"
                  ? "All party balances"
                  : "Customers with debit balance",
            );
            setRows(
              filtered.map((r) => ({
                Code: r.party_code,
                Party: r.name_en,
                City: r.city || "",
                Sector: r.route || "",
                Balance: signedText(r.balance),
                "Credit limit": r.credit_limit,
              })),
            );
          }
        } else if (kind === "aging") {
          const date = asOf || new Date().toISOString().slice(0, 10);
          const aging = await offlineReceivableAging(companyId, date);
          if (cancelled) return;
          setCount(aging.length);
          setTotal(aging.reduce((s, r) => s + r.balance, 0));
          setSecondTotal(aging.reduce((s, r) => s + r.bucket_90 + r.bucket_90_plus, 0));
          setSecondLabel("90+ due");
          setSubtitle(`As of ${date}`);
          setRows(
            aging.map((r) => ({
              "Customer code": r.party_code,
              Customer: r.name_en,
              City: r.city,
              Sector: r.route,
              "Balance amount": r.balance,
              days_0_30: r.bucket_current,
              days_31_60: r.bucket_30,
              days_61_90: r.bucket_60,
              days_90_plus: r.bucket_90,
              other: r.bucket_90_plus,
              credit_limit: r.credit_limit,
            })),
          );
        } else if (kind === "profit") {
          const p = await offlineProfitSummary(filters);
          if (cancelled) return;
          setCount(1);
          setTotal(p.net_profit);
          setSecondTotal(p.gross_profit);
          setSecondLabel("Gross profit");
          setSubtitle(
            `${p.from || "…"} → ${p.to || "…"} · ${p.note || "Offline estimate"}`,
          );
          setRows([
            { Item: "Gross sales", Amount: p.sales },
            { Item: "Less: sale returns", Amount: -p.returns },
            { Item: "Less: expiry credits", Amount: -p.expiry_credits },
            { Item: "Net sales", Amount: p.net_sales },
            { Item: "Less: estimated COGS", Amount: -p.cogs },
            { Item: "Gross profit", Amount: p.gross_profit },
            { Item: "Plus: expiry vendor claims", Amount: p.expiry_vendor_net },
            { Item: "Purchases (gross)", Amount: p.purchases_gross },
            { Item: "Less: purchase returns", Amount: -p.purchase_returns },
            { Item: "Net purchases", Amount: p.purchases },
            { Item: "Less: operating expenses", Amount: -p.expenses },
            { Item: "  — Salary", Amount: -p.salary },
            { Item: "  — Other", Amount: -p.other_expenses },
            { Item: "Net profit", Amount: p.net_profit },
          ]);
        } else {
          // salesman_ledger
          const opts = await offlineSalesmenOptions(companyId);
          if (cancelled) return;
          setSalesmen(opts);
          if (!salesmanId) {
            setCount(0);
            setTotal(0);
            setRows([]);
            setSubtitle("Choose a salesman to open the offline ledger");
          } else {
            const ledger = await offlineSalesmanLedger({
              companyId,
              salesmanId,
              from,
              to,
            });
            if (cancelled) return;
            setCount(ledger.lines.length);
            setTotal(ledger.totals.netCash);
            setSecondTotal(ledger.totals.sales);
            setSecondLabel("Sales");
            setSubtitle(
              `${ledger.salesmanName} · ${from || "…"} → ${to || "…"}`,
            );
            setRows(
              ledger.lines.map((l) => ({
                Date: l.date,
                Type: l.type,
                Particulars: l.particulars,
                "Sale amount": l.sales,
                "Cash collected": l.collected,
                "Expense paid": l.expense,
                "Running cash": l.running,
              })),
            );
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, companyId, from, to, view, partyId, salesmanId, asOf]);

  if (loading) {
    return (
      <div className="animate-rise space-y-6">
        <PageHeading title={meta.title} description={meta.description} />
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div className="animate-rise space-y-6">
      <PageHeading title={meta.title} description={meta.description} />

      {kind === "accounts" ? (
        <div className="no-print flex flex-wrap gap-2 text-sm">
          {(
            [
              ["receivable", "Receivable"],
              ["payable", "Payable"],
              ["all", "All"],
              ["ledger", "Ledger"],
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={
                key === "ledger"
                  ? `/reports/accounts?view=ledger${partyId ? `&party=${partyId}` : ""}`
                  : `/reports/accounts?view=${key}`
              }
              className={`rounded-lg border px-3 py-1.5 ${
                (view || "receivable") === key
                  ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                  : "border-[var(--border)] bg-white text-[var(--muted)]"
              }`}
            >
              {label}
            </Link>
          ))}
          {(view || "receivable") === "ledger" ? (
            <form className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="view" value="ledger" />
              <label className="text-xs text-[var(--muted)]">
                Party
                <select
                  name="party"
                  defaultValue={partyId || ""}
                  className="mt-1 block h-9 min-w-[14rem] rounded-lg border border-[var(--border)] px-2"
                >
                  <option value="">Select party</option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.party_code} — {p.name_en}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                className="h-9 rounded-lg bg-[var(--brand)] px-3 text-white"
              >
                Open
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {kind === "salesman_ledger" ? (
        <form
          action="/reports/salesman-ledger"
          className="no-print flex flex-wrap items-end gap-2 rounded-xl border border-[var(--border)] bg-white p-3"
        >
          <label className="text-xs text-[var(--muted)]">
            From
            <input
              type="date"
              name="from"
              defaultValue={from || ""}
              className="mt-1 block h-9 rounded-lg border border-[var(--border)] px-2"
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            To
            <input
              type="date"
              name="to"
              defaultValue={to || ""}
              className="mt-1 block h-9 rounded-lg border border-[var(--border)] px-2"
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Salesman
            <select
              name="salesman"
              defaultValue={salesmanId || ""}
              className="mt-1 block h-9 min-w-[14rem] rounded-lg border border-[var(--border)] px-2"
            >
              <option value="">Select salesman</option>
              {salesmen.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="h-9 rounded-lg bg-[var(--brand)] px-3 text-sm font-medium text-white"
          >
            Open
          </button>
        </form>
      ) : null}

      {kind === "aging" ? (
        <form className="no-print flex flex-wrap items-end gap-2">
          <label className="text-xs text-[var(--muted)]">
            As of
            <input
              type="date"
              name="date"
              defaultValue={asOf || new Date().toISOString().slice(0, 10)}
              className="mt-1 block h-9 rounded-lg border border-[var(--border)] px-2"
            />
          </label>
          <button
            type="submit"
            className="h-9 rounded-lg bg-[var(--brand)] px-3 text-sm font-medium text-white"
          >
            Refresh
          </button>
        </form>
      ) : null}

      {kind === "profit" ? (
        <form className="no-print flex flex-wrap items-end gap-2 rounded-xl border border-[var(--border)] bg-white p-3">
          <label className="text-xs text-[var(--muted)]">
            From
            <input
              type="date"
              name="from"
              defaultValue={from || ""}
              className="mt-1 block h-9 rounded-lg border border-[var(--border)] px-2"
            />
          </label>
          <label className="text-xs text-[var(--muted)]">
            To
            <input
              type="date"
              name="to"
              defaultValue={to || ""}
              className="mt-1 block h-9 rounded-lg border border-[var(--border)] px-2"
            />
          </label>
          <button
            type="submit"
            className="h-9 rounded-lg bg-[var(--brand)] px-3 text-sm font-medium text-white"
          >
            Refresh
          </button>
        </form>
      ) : null}

      <StatsGrid>
        <StatCard
          label="Rows"
          value={count}
          format="number"
          icon={Rows3}
          hint="Total records"
        />
        {kind !== "stock" ? (
          <StatCard
            label={
              kind === "accounts"
                ? "Receivable"
                : kind === "profit"
                  ? "Net profit"
                  : kind === "salesman_ledger"
                    ? "Net cash"
                    : "Total"
            }
            value={total}
            format="money"
            icon={FileSpreadsheet}
            hint={formatPkr(total)}
          />
        ) : null}
        {secondTotal != null ? (
          <StatCard
            label={secondLabel}
            value={secondTotal}
            format="money"
            icon={FileSpreadsheet}
            hint={formatPkr(secondTotal)}
          />
        ) : null}
      </StatsGrid>

      {!salesmanId && kind === "salesman_ledger" ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] bg-white px-4 py-6 text-sm text-[var(--muted)]">
          Choose a salesman above to open his running ledger.
        </p>
      ) : (
        <ReportTable
          title={meta.title}
          subtitle={
            subtitle ||
            (from || to
              ? `Period ${from || "…"} → ${to || "…"}`
              : "Report overview")
          }
          companyName={companyName}
          rows={rows}
          filename={`${kind}-report`}
        />
      )}
    </div>
  );
}

"use client";

import { OfflineBanner } from "@/components/offline/offline-banner";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useOfflineData } from "@/hooks/use-offline-data";
import { formatPkr } from "@/lib/utils";
import Link from "next/link";
import { useMemo } from "react";

export function OfflineNightClosingPage({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: sales, loading: salesLoading } = useOfflineData("sale_invoices", companyId);
  const { data: purchases, loading: purchasesLoading } = useOfflineData("purchase_invoices", companyId);
  const { data: vouchers, loading: vouchersLoading } = useOfflineData("vouchers", companyId);

  const loading = salesLoading || purchasesLoading || vouchersLoading;

  const summary = useMemo(() => {
    let salesTotal = 0;
    let cashSales = 0;
    let creditSales = 0;

    for (const s of sales) {
      const d = String(s.invoice_date || s.doc_date || "").slice(0, 10);
      if (d === today) {
        const tot = Number(s.grand_total || s.amount || 0);
        const paid = Number(s.amount_paid || (String(s.payment_type).toLowerCase() === "cash" ? tot : 0));
        salesTotal += tot;
        cashSales += paid;
        creditSales += Math.max(0, tot - paid);
      }
    }

    let recoveriesTotal = 0;
    for (const v of vouchers) {
      const d = String(v.recovery_date || v.voucher_date || v.doc_date || "").slice(0, 10);
      const t = String(v.voucher_type || v.type || "");
      if (d === today && (t === "recovery" || t === "cash_receipt" || t === "CR" || !t)) {
        recoveriesTotal += Number(v.amount ?? v.total_amount ?? v.grand_total ?? 0);
      }
    }

    let purchasesTotal = 0;
    for (const p of purchases) {
      const d = String(p.invoice_date || p.doc_date || "").slice(0, 10);
      if (d === today) {
        purchasesTotal += Number(p.grand_total || p.amount || 0);
      }
    }

    return {
      sales_total: salesTotal,
      cash_sales: cashSales,
      credit_sales: creditSales,
      recoveries_total: recoveriesTotal,
      purchases_total: purchasesTotal,
    };
  }, [sales, purchases, vouchers, today]);

  if (loading) {
    return (
      <div className="animate-rise space-y-6">
        <OfflineBanner companyId={companyId} />
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div className="animate-rise space-y-6">
      <OfflineBanner companyId={companyId} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Night closing
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            End-of-day totals for {companyName} (offline calculations)
          </p>
        </div>
        <Link
          href="/settings/sync"
          className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white"
        >
          Open sync & close
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Sales", summary.sales_total],
          ["Cash/Paid", summary.cash_sales],
          ["Credit", summary.credit_sales],
          ["Recoveries", summary.recoveries_total],
          ["Purchases", summary.purchases_total],
        ].map(([label, value]) => (
          <div key={String(label)} className="stat-tile">
            <p className="text-xs uppercase text-[var(--muted)]">{label}</p>
            <p className="mt-2 text-lg font-semibold">{formatPkr(Number(value || 0))}</p>
          </div>
        ))}
      </div>

      <div className="panel p-6">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          Offline Session Notice
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          All transactions are safely recorded on this computer. To permanently close the day and upload offline invoices and recoveries to cloud storage, connect to the internet and open <strong>Sync & night closing</strong>.
        </p>
        <div className="mt-4">
          <Link
            href="/settings/sync"
            className="inline-flex items-center rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium hover:border-[var(--brand)]"
          >
            Go to Sync dashboard →
          </Link>
        </div>
      </div>
    </div>
  );
}

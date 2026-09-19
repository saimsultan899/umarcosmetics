"use client";

import { PrintDocument } from "@/components/trading/print-document";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useExpiryStockItem } from "@/hooks/use-expiry-stock-item";
import type { ExpiryStockRow } from "@/lib/queries/expiry";
import type { Company } from "@/lib/types/database";
import { formatPkr } from "@/lib/utils";
import Link from "next/link";

export function ExpiryStockItemView({
  company,
  productId,
  initialRow,
  initialOffline = false,
  autoPrint = false,
}: {
  company: Company;
  productId: string;
  initialRow?: ExpiryStockRow | null;
  initialOffline?: boolean;
  autoPrint?: boolean;
}) {
  const { row, loading, notFound } = useExpiryStockItem({
    companyId: company.id,
    productId,
    initialRow,
    initialOffline,
  });

  if (loading) {
    return <PageSkeleton />;
  }

  if (notFound || !row) {
    return (
      <div className="panel p-8 text-center">
        <h2 className="text-xl font-semibold">Product not found in expiry stock</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Could not find this product in the expiry warehouse.
        </p>
        <Link
          href="/inventory/expiry"
          className="mt-4 inline-flex items-center rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          Back to expiry warehouse
        </Link>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="animate-rise space-y-4">
      <PrintDocument
        companyName={company.name}
        companyAddress={[company.address, company.city].filter(Boolean).join(", ")}
        title="Expiry Warehouse — On-hand"
        docNo={row.product_code}
        date={today}
        printedAt={new Date().toISOString()}
        extraMeta={[{ label: "Item", value: row.product_name }]}
        lines={[
          {
            product_code: row.product_code,
            product_name: row.product_name,
            qty: row.qty,
            rate: row.rate,
            amount: row.amount,
          },
        ]}
        totals={[{ label: "Value", value: formatPkr(row.amount), strong: true }]}
        autoPrint={autoPrint}
      />
    </div>
  );
}

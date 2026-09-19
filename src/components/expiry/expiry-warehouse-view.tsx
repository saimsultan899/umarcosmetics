"use client";

import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { ExpiryClaimForm } from "@/components/expiry/expiry-claim-form";
import { ExpiryReceiptForm } from "@/components/expiry/expiry-receipt-form";
import { ExpiryStockTable } from "@/components/expiry/expiry-stock-table";
import { DocumentListTable } from "@/components/tables/document-list-table";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import {
  useExpiryWarehouse,
  type ExpiryWarehouseData,
} from "@/hooks/use-expiry-warehouse";
import type { Company, Party, Product, Warehouse } from "@/lib/types/database";
import { cn, formatPkr } from "@/lib/utils";
import { Archive, FileText, Package, Truck } from "lucide-react";
import Link from "next/link";

const TABS = [
  { key: "stock", label: "On-hand" },
  { key: "receipts", label: "Customer returns" },
  { key: "claims", label: "Vendor claims" },
] as const;

export function ExpiryWarehouseView({
  company,
  initialData,
  initialParties = [],
  initialProducts = [],
  initialWarehouses = [],
  initialOffline = false,
}: {
  company: Company;
  initialData?: ExpiryWarehouseData | null;
  initialParties?: Party[];
  initialProducts?: Product[];
  initialWarehouses?: Warehouse[];
  initialOffline?: boolean;
}) {
  const {
    stock,
    receipts,
    claims,
    stats,
    activeTab,
    parties,
    products,
    warehouses,
    loading,
    refetch,
  } = useExpiryWarehouse({
    company,
    initialData,
    initialParties,
    initialProducts,
    initialWarehouses,
    initialOffline,
  });

  if (loading && !stock.length && !receipts.rows.length && !claims.rows.length) {
    return <PageSkeleton />;
  }

  return (
    <div className="animate-rise space-y-6">
      <div className="no-print space-y-6">
        <PageHeading
          title="Expiry Warehouse"
          description="Receive expired goods from shops (credits the customer), hold them off saleable stock, send a claim to the manufacturer, then settle as a credit or a physical return."
          actions={
            <>
              <CreateDialogButton
                label="Customer return"
                title="Customer expiry return"
                description="Load billed items for a date range, then adjust qty or amount to recover the shop’s balance."
                size="xl"
              >
                <ExpiryReceiptForm
                  companyId={company.id}
                  organizationId={company.organization_id}
                  parties={parties}
                  products={products}
                  onDone={refetch}
                />
              </CreateDialogButton>
              <CreateDialogButton
                label="Vendor claim"
                title="Send expiry stock to vendor"
                description="The company will verify the goods. Settle later if they accept, reject, or split the claim."
                size="xl"
              >
                <ExpiryClaimForm
                  companyId={company.id}
                  organizationId={company.organization_id}
                  parties={parties}
                  warehouses={warehouses}
                  stock={stock}
                  onDone={refetch}
                />
              </CreateDialogButton>
            </>
          }
        />

        <StatsGrid>
          <StatCard
            label="Products on hand"
            value={stats.productsOnHand}
            format="number"
            icon={Package}
          />
          <StatCard
            label="Expiry qty"
            value={stats.onHandQty}
            format="number"
            icon={Archive}
            hint={formatPkr(stats.onHandValue)}
          />
          <StatCard
            label="Open vendor claims"
            value={stats.openClaimsCount}
            format="number"
            icon={Truck}
            href="/inventory/expiry?tab=claims"
          />
          <StatCard
            label="Customer credit this month"
            value={stats.monthCredit}
            format="money"
            icon={FileText}
            href="/inventory/expiry?tab=receipts"
          />
        </StatsGrid>

        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/inventory/expiry?tab=${t.key}`}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                activeTab === t.key
                  ? "bg-[var(--brand)] text-white shadow-sm"
                  : "border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--ink)]",
              )}
            >
              {t.label}
            </Link>
          ))}
          <Link
            href="/reports/expiry"
            className="rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
          >
            Expiry report
          </Link>
        </div>
      </div>

      {activeTab === "stock" ? (
        <ExpiryStockTable
          companyId={company.id}
          companyName={company.name}
          rows={stock}
        />
      ) : null}

      {activeTab === "receipts" ? (
        <DocumentListTable
          title="Customer expiry returns"
          rows={receipts.rows}
          pagination={receipts.pagination}
          summary={receipts.summary}
          showPrint
        />
      ) : null}

      {activeTab === "claims" ? (
        <DocumentListTable
          title="Vendor expiry claims"
          rows={claims.rows}
          pagination={claims.pagination}
          summary={claims.summary}
          warehouses={warehouses}
          partyColumnLabel="Vendor"
          showPrint
        />
      ) : null}
    </div>
  );
}

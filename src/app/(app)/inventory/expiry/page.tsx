import { ExpiryClaimForm } from "@/components/expiry/expiry-claim-form";
import { ExpiryReceiptForm } from "@/components/expiry/expiry-receipt-form";
import { ExpiryStockTable } from "@/components/expiry/expiry-stock-table";
import { DocumentListTable } from "@/components/tables/document-list-table";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { loadTradingMasters } from "@/lib/trading-data";
import {
  documentListConfigs,
  fetchDocumentList,
} from "@/lib/queries/documents";
import { fetchExpiryStock } from "@/lib/queries/expiry";
import { cn, formatPkr } from "@/lib/utils";
import { Archive, FileText, Package, Truck } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

const TABS = [
  { key: "stock", label: "On-hand" },
  { key: "receipts", label: "Customer returns" },
  { key: "claims", label: "Vendor claims" },
] as const;

export default async function ExpiryWarehousePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tabRaw = typeof sp.tab === "string" ? sp.tab : "stock";
  const tab = TABS.some((t) => t.key === tabRaw) ? tabRaw : "stock";

  const { company, parties, products, warehouses, supabase } =
    await loadTradingMasters();

  const monthStart = new Date();
  monthStart.setDate(1);
  const monthFrom = monthStart.toISOString().slice(0, 10);

  const [stock, receipts, claims, monthReceipts, openClaims] = await Promise.all([
    fetchExpiryStock(supabase, company.id),
    fetchDocumentList(
      supabase,
      company.id,
      sp,
      documentListConfigs.expiryReceipt,
    ),
    fetchDocumentList(
      supabase,
      company.id,
      sp,
      documentListConfigs.expiryClaim,
    ),
    supabase
      .from("expiry_receipts")
      .select("grand_total")
      .eq("company_id", company.id)
      .gte("receipt_date", monthFrom),
    supabase
      .from("expiry_claims")
      .select("id", { count: "exact", head: true })
      .eq("company_id", company.id)
      .eq("claim_status", "open"),
  ]);

  const onHandQty = stock.reduce((s, r) => s + r.qty, 0);
  const onHandValue = stock.reduce((s, r) => s + r.amount, 0);
  const monthCredit = (monthReceipts.data || []).reduce(
    (s, r) => s + Number(r.grand_total || 0),
    0,
  );

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
              />
            </CreateDialogButton>
          </>
        }
      />

      <StatsGrid>
        <StatCard
          label="Products on hand"
          value={stock.length}
          format="number"
          icon={Package}
        />
        <StatCard
          label="Expiry qty"
          value={onHandQty}
          format="number"
          icon={Archive}
          hint={formatPkr(onHandValue)}
        />
        <StatCard
          label="Open vendor claims"
          value={openClaims.count || 0}
          format="number"
          icon={Truck}
          href="/inventory/expiry?tab=claims"
        />
        <StatCard
          label="Customer credit this month"
          value={monthCredit}
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
              "rounded-md px-3 py-1.5 text-sm font-medium",
              tab === t.key
                ? "bg-[var(--brand)] text-white"
                : "border border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--ink)]",
            )}
          >
            {t.label}
          </Link>
        ))}
        <Link
          href="/reports/expiry"
          className="rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)]"
        >
          Expiry report
        </Link>
      </div>
      </div>

      {tab === "stock" ? (
        <ExpiryStockTable
          companyId={company.id}
          companyName={company.name}
          rows={stock}
        />
      ) : null}

      {tab === "receipts" ? (
        <Suspense fallback={<PageSkeleton />}>
          <DocumentListTable
            title="Customer expiry returns"
            rows={receipts.rows}
            pagination={receipts.pagination}
            summary={receipts.summary}
            showPrint
          />
        </Suspense>
      ) : null}

      {tab === "claims" ? (
        <Suspense fallback={<PageSkeleton />}>
          <DocumentListTable
            title="Vendor expiry claims"
            rows={claims.rows}
            pagination={claims.pagination}
            summary={claims.summary}
            warehouses={warehouses}
            partyColumnLabel="Vendor"
            showPrint
          />
        </Suspense>
      ) : null}
    </div>
  );
}

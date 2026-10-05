"use client";

import { VouchersTable } from "@/components/tables/vouchers-table";
import { CreateDialogButton, PageHeading } from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { CashVoucherForm } from "@/components/vouchers/voucher-lines-form";
import { JournalVoucherForm } from "@/components/vouchers/journal-form";
import { useVoucherList } from "@/hooks/use-voucher-lists";
import { CatalogSlot, useTradingCatalog } from "@/lib/trading/catalog-client";
import type { VoucherListResult } from "@/lib/queries/vouchers";
import type { Company, Party } from "@/lib/types/database";

type VoucherKind = "CR" | "CP" | "JV";

const VOUCHER_META: Record<
  VoucherKind,
  {
    title: string;
    description: string;
    addLabel: string;
    addTitle: string;
    addDescription: string;
    emptyLabel: string;
    detailBasePath: string;
  }
> = {
  CR: {
    title: "Cash Receipt",
    description:
      "Record money received from customers (reduces receivable). Vendor expiry claim credits are also cleared here if the company pays cash.",
    addLabel: "New receipt",
    addTitle: "New cash receipt",
    addDescription: "Post money received against customers",
    emptyLabel: "No cash receipts yet.",
    detailBasePath: "/vouchers/cash-receipt",
  },
  CP: {
    title: "Cash Payment",
    description: "Record money paid to vendors / accounts",
    addLabel: "New payment",
    addTitle: "New cash payment",
    addDescription: "Post money paid against vendors / accounts",
    emptyLabel: "No cash payments yet.",
    detailBasePath: "/vouchers/cash-payment",
  },
  JV: {
    title: "Journal Voucher",
    description: "Transfer amounts between debit and credit accounts",
    addLabel: "New journal",
    addTitle: "New journal voucher",
    addDescription: "Post balanced debit / credit lines",
    emptyLabel: "No journal vouchers yet.",
    detailBasePath: "/vouchers/journal",
  },
};

export function VouchersView({
  company,
  kind,
  initialData,
  initialParties = [],
  initialOffline = false,
}: {
  company: Company;
  kind: VoucherKind;
  initialData?: VoucherListResult | null;
  initialParties?: Party[];
  initialOffline?: boolean;
}) {
  const { vouchers, pagination, parties, loading, refetch } = useVoucherList({
    companyId: company.id,
    kind,
    initialData,
    initialParties,
    initialOffline,
  });
  const catalog = useTradingCatalog(company.id, { enabled: !initialOffline });
  const formParties = parties.length ? parties : catalog.parties;

  const meta = VOUCHER_META[kind];

  if (loading && !vouchers.length) return <PageSkeleton />;

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title={meta.title}
        description={meta.description}
        actions={
          <CreateDialogButton
            label={meta.addLabel}
            title={meta.addTitle}
            description={meta.addDescription}
            size="xl"
          >
            <CatalogSlot
              ready={initialOffline || parties.length > 0 || catalog.ready}
              error={catalog.error}
            >
              {kind === "JV" ? (
                <JournalVoucherForm
                  companyId={company.id}
                  organizationId={company.organization_id}
                  parties={formParties}
                  onDone={refetch}
                />
              ) : (
                <CashVoucherForm
                  kind={kind}
                  companyId={company.id}
                  organizationId={company.organization_id}
                  parties={formParties}
                  onDone={refetch}
                />
              )}
            </CatalogSlot>
          </CreateDialogButton>
        }
      />

      <VouchersTable
        vouchers={vouchers}
        pagination={pagination}
        emptyLabel={meta.emptyLabel}
        detailBasePath={meta.detailBasePath}
      />
    </div>
  );
}

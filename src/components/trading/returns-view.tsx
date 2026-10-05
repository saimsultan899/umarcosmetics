"use client";

import { DocumentListTable } from "@/components/tables/document-list-table";
import { ReturnForm } from "@/components/trading/return-form";
import { Button } from "@/components/ui/button";
import { CreateDialogButton, PageHeading } from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useReturnsList, type ReturnKind } from "@/hooks/use-returns-list";
import { CatalogSlot, useTradingCatalog } from "@/lib/trading/catalog-client";
import type { DocumentListRow, DocumentListSummary } from "@/lib/queries/documents";
import type { PaginationMeta } from "@/lib/pagination";
import type { Company, Party, Product, Warehouse } from "@/lib/types/database";
import Link from "next/link";

type ReturnListResult = {
  rows: DocumentListRow[];
  pagination: PaginationMeta;
  summary: DocumentListSummary;
};

const META: Record<
  ReturnKind,
  {
    title: string;
    description: string;
    addLabel: string;
    addTitle: string;
    addDescription: string;
    tableTitle: string;
    expiryHref: string;
    partyColumnLabel?: string;
    showPrint?: boolean;
  }
> = {
  sale: {
    title: "Sale Return",
    description:
      "Receive saleable returned goods. Expired items go to Expiry Warehouse instead.",
    addLabel: "New return",
    addTitle: "New sale return",
    addDescription: "Restore stock from a customer return",
    tableTitle: "Sale returns",
    expiryHref: "/inventory/expiry",
    showPrint: true,
  },
  purchase: {
    title: "Purchase Return",
    description:
      "Return saleable stock to vendors. Expired claims use Expiry Warehouse.",
    addLabel: "New return",
    addTitle: "New purchase return",
    addDescription: "Return stock to a vendor",
    tableTitle: "Purchase returns",
    expiryHref: "/inventory/expiry?tab=claims",
    partyColumnLabel: "Vendor",
  },
};

export function ReturnsView({
  company,
  kind,
  initialData,
  initialParties = [],
  initialProducts = [],
  initialWarehouses = [],
  initialOffline = false,
}: {
  company: Company;
  kind: ReturnKind;
  initialData?: ReturnListResult | null;
  initialParties?: Party[];
  initialProducts?: Product[];
  initialWarehouses?: Warehouse[];
  initialOffline?: boolean;
}) {
  const { rows, pagination, summary, parties, products, warehouses, loading, refetch } =
    useReturnsList({
      companyId: company.id,
      kind,
      initialData,
      initialParties,
      initialProducts,
      initialWarehouses,
      initialOffline,
    });
  const catalog = useTradingCatalog(company.id, { enabled: !initialOffline });
  const formParties = parties.length ? parties : catalog.parties;
  const formProducts = products.length ? products : catalog.products;
  const formWarehouses = warehouses.length ? warehouses : catalog.warehouses;

  const meta = META[kind];

  if (loading && !rows.length) return <PageSkeleton />;

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title={meta.title}
        description={meta.description}
        actions={
          <>
            <Link href={meta.expiryHref}>
              <Button variant="secondary" size="sm">
                Expiry warehouse
              </Button>
            </Link>
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
                <ReturnForm
                  kind={kind}
                  companyId={company.id}
                  organizationId={company.organization_id}
                  parties={formParties}
                  products={formProducts}
                  warehouses={formWarehouses}
                />
              </CatalogSlot>
            </CreateDialogButton>
          </>
        }
      />

      <DocumentListTable
        title={meta.tableTitle}
        rows={rows}
        pagination={pagination}
        summary={summary}
        warehouses={formWarehouses}
        showPrint={meta.showPrint}
        partyColumnLabel={meta.partyColumnLabel}
      />
    </div>
  );
}

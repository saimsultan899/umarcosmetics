import { DocumentListTable } from "@/components/tables/document-list-table";
import { ReturnForm } from "@/components/trading/return-form";
import { Button } from "@/components/ui/button";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { loadTradingMasters } from "@/lib/trading-data";
import {
  documentListConfigs,
  fetchDocumentList,
} from "@/lib/queries/documents";
import Link from "next/link";
import { Suspense } from "react";

export default async function PurchaseReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { company, parties, products, warehouses, supabase } =
    await loadTradingMasters();

  const list = await fetchDocumentList(
    supabase,
    company.id,
    sp,
    documentListConfigs.purchaseReturn,
  );

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Purchase Return"
        description="Return saleable stock to vendors. Expired claims use Expiry Warehouse."
        actions={
          <>
            <Link href="/inventory/expiry?tab=claims">
              <Button variant="secondary" size="sm">
                Expiry warehouse
              </Button>
            </Link>
            <CreateDialogButton
            label="New return"
            title="New purchase return"
            description="Return stock to a vendor"
            size="xl"
          >
            <ReturnForm
              kind="purchase"
              companyId={company.id}
              organizationId={company.organization_id}
              parties={parties}
              products={products}
              warehouses={warehouses}
            />
            </CreateDialogButton>
          </>
        }
      />

      <Suspense fallback={<PageSkeleton />}>
        <DocumentListTable
          title="Purchase returns"
          rows={list.rows}
          pagination={list.pagination}
          summary={list.summary}
          warehouses={warehouses}
          partyColumnLabel="Vendor"
        />
      </Suspense>
    </div>
  );
}

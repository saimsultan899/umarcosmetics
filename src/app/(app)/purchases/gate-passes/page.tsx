import { GatePassesTable } from "@/components/tables/gate-passes-table";
import { GatePassForm } from "@/components/trading/gate-pass-form";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { fetchGatePassList } from "@/lib/queries/gate-passes";
import { loadTradingMasters } from "@/lib/trading-data";
import { Suspense } from "react";

export default async function GatePassesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { company, parties, products, warehouses, supabase } =
    await loadTradingMasters();
  const list = await fetchGatePassList(supabase, company.id, sp);

  const canCreate = products.length > 0;

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Gate Pass"
        description={`Incoming company load for ${company.name} — match goods here, then post purchase to add stock.`}
        actions={
          <CreateDialogButton
            label="New gate pass"
            title="New gate pass"
            description="List products on the arriving load. Does not update inventory."
            size="xl"
            disabled={!canCreate}
            disabledHint="Add products first, then create a gate pass from the catalog."
          >
            <GatePassForm
              companyId={company.id}
              organizationId={company.organization_id}
              companyName={company.name}
              companyCity={company.city}
              companyNtn={company.ntn}
              parties={parties}
              products={products}
              warehouses={warehouses}
            />
          </CreateDialogButton>
        }
      />

      <Suspense fallback={<PageSkeleton />}>
        <GatePassesTable
          rows={list.rows}
          pagination={list.pagination}
          warehouses={warehouses}
        />
      </Suspense>
    </div>
  );
}

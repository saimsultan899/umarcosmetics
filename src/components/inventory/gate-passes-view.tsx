"use client";

import { GatePassesTable } from "@/components/tables/gate-passes-table";
import { GatePassForm } from "@/components/trading/gate-pass-form";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useGatePassList } from "@/hooks/use-inventory-lists";
import type { GatePassListResult } from "@/lib/queries/gate-passes";
import type { Company, Party, Product, Warehouse } from "@/lib/types/database";

export function GatePassesView({
  company,
  initialData,
  initialWarehouses = [],
  initialParties = [],
  initialProducts = [],
  initialOffline = false,
}: {
  company: Company;
  initialData?: GatePassListResult | null;
  initialWarehouses?: Warehouse[];
  initialParties?: Party[];
  initialProducts?: Product[];
  initialOffline?: boolean;
}) {
  const { rows, pagination, warehouses, parties, products, loading, refetch } =
    useGatePassList({
      companyId: company.id,
      initialData,
      initialWarehouses,
      initialParties,
      initialProducts,
      initialOffline,
    });

  const canCreate = products.length > 0;

  if (loading && !rows.length) {
    return <PageSkeleton />;
  }

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

      <GatePassesTable
        rows={rows}
        pagination={pagination}
        warehouses={warehouses}
      />
    </div>
  );
}

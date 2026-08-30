import { LoadSheetsTable } from "@/components/tables/load-sheets-table";
import { LoadSheetForm } from "@/components/trading/load-sheet-form";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { requireCompanyContext } from "@/lib/auth";
import { fetchLoadSheetList } from "@/lib/queries/load-sheets";
import { fetchCompanySalesmen } from "@/lib/queries/salesmen";
import { Suspense } from "react";

export default async function LoadSheetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();

  const [{ data: products }, { data: warehouses }, salesmen, list] =
    await Promise.all([
      supabase
        .from("products")
        .select("*")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("code"),
      supabase
        .from("warehouses")
        .select("*")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("name"),
      fetchCompanySalesmen(supabase, company.id),
      fetchLoadSheetList(supabase, company.id, sp),
    ]);

  const canCreate =
    (warehouses || []).length > 0 && (products || []).length > 0;

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Van load sheets"
        description={`Issue stock to salesman vans before market — for ${company.name}`}
        actions={
          <CreateDialogButton
            label="Create load"
            title="Create load sheet"
            description="Issue van stock for a market sector"
            size="xl"
            disabled={!canCreate}
            disabledHint="Add products and companies first, then create van loads."
          >
            <LoadSheetForm
              companyId={company.id}
              organizationId={company.organization_id}
              products={products || []}
              warehouses={warehouses || []}
              salesmen={salesmen}
            />
          </CreateDialogButton>
        }
      />

      <Suspense fallback={<PageSkeleton />}>
        <LoadSheetsTable
          rows={list.rows}
          pagination={list.pagination}
          warehouses={warehouses || []}
        />
      </Suspense>
    </div>
  );
}

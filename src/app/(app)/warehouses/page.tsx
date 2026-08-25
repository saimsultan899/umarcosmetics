import { WarehouseForm } from "@/components/forms/warehouse-form";
import { WarehousesList } from "@/components/tables/warehouses-list";
import { Button } from "@/components/ui/button";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { requireCompanyContext } from "@/lib/auth";
import type { Warehouse } from "@/lib/types/database";
import Link from "next/link";

export default async function WarehousesPage() {
  const { supabase, company } = await requireCompanyContext();
  const { data: warehouses } = await supabase
    .from("warehouses")
    .select("*")
    .eq("company_id", company.id)
    .eq("is_active", true)
    .order("name");

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Warehouses"
        description="Brand / store locations for stock (e.g. KEUNE, CITY GIRL)"
        actions={
          <>
            <Link href="/warehouses/transfers">
              <Button variant="secondary" size="sm">
                Stock transfer
              </Button>
            </Link>
            <CreateDialogButton
              label="Add warehouse"
              title="Add warehouse"
              description="Create a warehouse or brand location"
            >
                <WarehouseForm
                  companyId={company.id}
                  organizationId={company.organization_id}
                />
            </CreateDialogButton>
          </>
        }
      />

      <WarehousesList
        warehouses={(warehouses as Warehouse[]) || []}
        companyId={company.id}
        organizationId={company.organization_id}
      />
    </div>
  );
}

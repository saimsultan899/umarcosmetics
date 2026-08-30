import { LocationListsManager } from "@/components/forms/location-lists-manager";
import { PartyForm } from "@/components/forms/party-form";
import { PartiesTable } from "@/components/tables/parties-table";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { requireCompanyContext } from "@/lib/auth";
import { fetchPartyList } from "@/lib/queries/parties";
import type { PartySubtype } from "@/lib/types/database";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/page-skeleton";

function subtypeFromTypeParam(type: unknown): PartySubtype | undefined {
  if (type === "supplier" || type === "customer" || type === "both" || type === "other") {
    return type;
  }
  return undefined;
}

export default async function PartiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();
  const list = await fetchPartyList(supabase, company.id, sp);
  const defaultSubtype = subtypeFromTypeParam(sp.type);
  const addingSupplier = defaultSubtype === "supplier";

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Customers / Chart of Accounts"
        description={`Customers, vendors, and ledger heads for ${company.name}. Stats and charts follow the table filter.`}
        actions={
          <>
          <CreateDialogButton
            label="City / Head & Sector"
            title="City / head & sector"
            description="City and head are one list. Sector is the second list."
            size="lg"
          >
            <LocationListsManager
              companyId={company.id}
              organizationId={company.organization_id}
              cityOptions={list.cityOptions}
              sectorOptions={list.sectorOptions}
            />
          </CreateDialogButton>
          <CreateDialogButton
            label={addingSupplier ? "Add vendor" : "Add customer"}
            title={addingSupplier ? "Add vendor" : "Add customer"}
            description={
              addingSupplier
                ? "Saved as a vendor for purchases and gate pass"
                : "Create a customer, vendor, or ledger head"
            }
            size="lg"
          >
            <PartyForm
              companyId={company.id}
              organizationId={company.organization_id}
              cityOptions={list.cityOptions}
              sectorOptions={list.sectorOptions}
              defaultSubtype={defaultSubtype}
            />
          </CreateDialogButton>
          </>
        }
      />

      <Suspense fallback={<PageSkeleton />}>
        <PartiesTable
          parties={list.parties}
          pagination={list.pagination}
          stats={list.stats}
          companyId={company.id}
          organizationId={company.organization_id}
          cityOptions={list.cityOptions}
          sectorOptions={list.sectorOptions}
          initialType={typeof sp.type === "string" ? sp.type : undefined}
        />
      </Suspense>
    </div>
  );
}

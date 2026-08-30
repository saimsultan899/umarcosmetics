import { LocationListsManager } from "@/components/forms/location-lists-manager";
import { PartyForm } from "@/components/forms/party-form";
import { PartiesTable } from "@/components/tables/parties-table";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { requireCompanyContext } from "@/lib/auth";
import { fetchPartyList } from "@/lib/queries/parties";
import type { PartySubtype, PartyType } from "@/lib/types/database";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/page-skeleton";

function subtypeFromTypeParam(type: unknown): PartySubtype | undefined {
  if (
    type === "supplier" ||
    type === "customer" ||
    type === "both" ||
    type === "other"
  ) {
    return type;
  }
  return undefined;
}

function pageMeta(sp: Record<string, string | string[] | undefined>) {
  const view = typeof sp.view === "string" ? sp.view : undefined;
  const type = typeof sp.type === "string" ? sp.type : undefined;

  if (view === "ledger") {
    return {
      title: "Chart of Accounts",
      description:
        "Ledger heads for bookkeeping — Assets, Capital, Expenses, and Income.",
      addLabel: "Add ledger head",
      addTitle: "Add ledger head",
      addDescription: "Create an accounting head used in vouchers and journals",
      defaultSubtype: undefined as PartySubtype | undefined,
      defaultPartyType: "EXPENSES" as PartyType,
      showLocations: false,
    };
  }

  if (type === "customer") {
    return {
      title: "Customers / Shops",
      description: "Retail and wholesale customers you sell to.",
      addLabel: "Add customer",
      addTitle: "Add customer",
      addDescription: "Create a customer or shop for sales invoices",
      defaultSubtype: "customer" as PartySubtype,
      defaultPartyType: "PARTY" as PartyType,
      showLocations: true,
    };
  }

  if (type === "supplier") {
    return {
      title: "Vendors",
      description: "Suppliers for purchases, gate pass, and stock inward.",
      addLabel: "Add vendor",
      addTitle: "Add vendor",
      addDescription: "Create a vendor for purchases and gate pass",
      defaultSubtype: "supplier" as PartySubtype,
      defaultPartyType: "PARTY" as PartyType,
      showLocations: true,
    };
  }

  return {
    title: "All parties",
    description:
      "Every account in one list — customers, vendors, and ledger heads.",
    addLabel: "Add party",
    addTitle: "Add party",
    addDescription: "Create a customer, vendor, or ledger head",
    defaultSubtype: undefined as PartySubtype | undefined,
    defaultPartyType: "PARTY" as PartyType,
    showLocations: true,
  };
}

export default async function PartiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();
  const list = await fetchPartyList(supabase, company.id, sp);
  const meta = pageMeta(sp);

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title={meta.title}
        description={`${meta.description} Company: ${company.name}.`}
        actions={
          <>
            {meta.showLocations ? (
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
            ) : null}
            <CreateDialogButton
              label={meta.addLabel}
              title={meta.addTitle}
              description={meta.addDescription}
              size="lg"
            >
              <PartyForm
                companyId={company.id}
                organizationId={company.organization_id}
                cityOptions={list.cityOptions}
                sectorOptions={list.sectorOptions}
                defaultSubtype={meta.defaultSubtype}
                defaultPartyType={meta.defaultPartyType}
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

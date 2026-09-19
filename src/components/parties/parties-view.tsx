"use client";

import { LocationListsManager } from "@/components/forms/location-lists-manager";
import { PartyForm } from "@/components/forms/party-form";
import { PartiesTable } from "@/components/tables/parties-table";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { usePartiesList } from "@/hooks/use-parties-list";
import type { PartyListResult } from "@/lib/queries/parties";
import type { Company, PartySubtype, PartyType } from "@/lib/types/database";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";

function getPageMeta(view?: string | null, type?: string | null) {
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

export function PartiesView({
  company,
  initialData,
  initialOffline = false,
}: {
  company: Company;
  initialData?: PartyListResult | null;
  initialOffline?: boolean;
}) {
  const searchParams = useSearchParams();
  const view = searchParams.get("view");
  const type = searchParams.get("type");

  const meta = useMemo(() => getPageMeta(view, type), [view, type]);

  const { data, loading, refetch } = usePartiesList({
    companyId: company.id,
    initialData,
    initialOffline,
  });

  if (loading && !data) {
    return <PageSkeleton />;
  }

  const currentData = data || {
    parties: [],
    pagination: {
      page: 1,
      pageSize: 24,
      total: 0,
      totalPages: 1,
      from: 0,
      to: 0,
    },
    stats: {
      total: 0,
      customers: 0,
      suppliers: 0,
      withCreditLimit: 0,
      subtypeMix: [],
      ledgerMix: [],
      cityBars: [],
      mode: (view === "ledger" ? "ledger" : "all") as "all" | "ledger" | "trading",
    },
    cityOptions: [],
    sectorOptions: [],
    headOptions: [],
  };

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
                  cityOptions={currentData.cityOptions}
                  sectorOptions={currentData.sectorOptions}
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
                cityOptions={currentData.cityOptions}
                sectorOptions={currentData.sectorOptions}
                defaultSubtype={meta.defaultSubtype}
                defaultPartyType={meta.defaultPartyType}
                onDone={refetch}
              />
            </CreateDialogButton>
          </>
        }
      />

      <PartiesTable
        parties={currentData.parties}
        pagination={currentData.pagination}
        stats={currentData.stats}
        companyId={company.id}
        organizationId={company.organization_id}
        cityOptions={currentData.cityOptions}
        sectorOptions={currentData.sectorOptions}
        initialType={type || undefined}
      />
    </div>
  );
}

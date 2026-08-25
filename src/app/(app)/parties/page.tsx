import { PartyForm } from "@/components/forms/party-form";
import { PartiesTable } from "@/components/tables/parties-table";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { requireCompanyContext } from "@/lib/auth";
import { fetchPartyList } from "@/lib/queries/parties";
import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/page-skeleton";

export default async function PartiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();
  const list = await fetchPartyList(supabase, company.id, sp);

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Parties / Chart of Accounts"
        description={`Shops, vendors, and ledger heads for ${company.name}. Stats and charts follow the table filter.`}
        actions={
          <CreateDialogButton
            label="Add party"
            title="Add party"
            description="Create a shop, supplier, or ledger head"
            size="lg"
          >
            <PartyForm
              companyId={company.id}
              organizationId={company.organization_id}
              cityOptions={list.cityOptions}
              sectorOptions={list.sectorOptions}
            />
          </CreateDialogButton>
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
          headOptions={list.headOptions}
          initialType={typeof sp.type === "string" ? sp.type : undefined}
        />
      </Suspense>
    </div>
  );
}

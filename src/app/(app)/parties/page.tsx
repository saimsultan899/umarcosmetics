import { PartyForm } from "@/components/forms/party-form";
import { PartiesTable } from "@/components/tables/parties-table";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { requireCompanyContext } from "@/lib/auth";
import type { Party } from "@/lib/types/database";

export default async function PartiesPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; view?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();

  const { data: parties } = await supabase
    .from("parties")
    .select("*")
    .eq("company_id", company.id)
    .eq("is_active", true)
    .order("party_code", { ascending: true })
    .limit(2000);

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
              />
          </CreateDialogButton>
        }
      />

      <PartiesTable
        parties={(parties as Party[] | null) || []}
        companyId={company.id}
        organizationId={company.organization_id}
        initialType={sp.type}
      />
    </div>
  );
}

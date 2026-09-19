import { CompanyProfileView } from "@/components/settings/company-profile-view";
import { requireCompanyContext } from "@/lib/auth";
import type { Company } from "@/lib/types/database";

export default async function CompanySettingsPage() {
  const { supabase, company, offline } = await requireCompanyContext();

  let orgCompanies: Company[] = [];
  if (!offline) {
    const { data } = await supabase
      .from("companies")
      .select("*")
      .eq("organization_id", company.organization_id)
      .eq("is_active", true)
      .order("name");
    orgCompanies = (data || []) as Company[];
  }

  return (
    <CompanyProfileView
      initialCompany={company as Company}
      initialOrgCompanies={orgCompanies}
      initialOffline={offline}
    />
  );
}

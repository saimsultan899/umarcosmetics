import { CompanyProfileView } from "@/components/settings/company-profile-view";
import { requireCompanyContext } from "@/lib/auth";
import type { Company } from "@/lib/types/database";

export default async function CompanySettingsPage() {
  const { supabase, company, offline } = await requireCompanyContext();

  let orgCompanies: Company[] = [];
  let mainCompanyId: string | null = null;
  if (!offline) {
    const [{ data }, { data: org }] = await Promise.all([
      supabase
        .from("companies")
        .select("*")
        .eq("organization_id", company.organization_id)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("organizations")
        .select("main_company_id")
        .eq("id", company.organization_id)
        .maybeSingle(),
    ]);
    orgCompanies = (data || []) as Company[];
    mainCompanyId = (org?.main_company_id as string | null) || null;
  }

  return (
    <CompanyProfileView
      initialCompany={company as Company}
      initialOrgCompanies={orgCompanies}
      initialMainCompanyId={mainCompanyId}
      initialOffline={offline}
    />
  );
}

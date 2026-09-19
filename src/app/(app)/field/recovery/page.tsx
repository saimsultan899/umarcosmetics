import { FieldRecoveryView } from "@/components/field/field-recovery-view";
import { requireCompanyContext } from "@/lib/auth";

export default async function FieldRecoveryPage() {
  const { supabase, company, offline } = await requireCompanyContext();

  let initialShops: Array<{
    party_id: string;
    party_code: string;
    name_en: string;
    balance: number;
  }> = [];

  if (!offline) {
    try {
      const { data } = await supabase.rpc("get_salesman_shops", {
        p_company_id: company.id,
        p_as_of: new Date().toISOString().slice(0, 10),
      });
      initialShops = (data || []) as typeof initialShops;
    } catch {
      initialShops = [];
    }
  }

  return (
    <FieldRecoveryView
      companyId={company.id}
      organizationId={company.organization_id}
      initialShops={initialShops}
      initialOffline={offline}
    />
  );
}

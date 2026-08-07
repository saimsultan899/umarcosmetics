import { FieldRecoveryForm } from "@/components/field/field-recovery-form";
import { requireCompanyContext } from "@/lib/auth";

export default async function FieldRecoveryPage() {
  const { supabase, company } = await requireCompanyContext();
  const { data: shops } = await supabase.rpc("get_salesman_shops", {
    p_company_id: company.id,
    p_as_of: new Date().toISOString().slice(0, 10),
  });

  return (
    <div className="animate-rise mx-auto w-full max-w-3xl space-y-5">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold sm:text-3xl">
          Collect recovery
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Works offline — syncs to main accounts when online
        </p>
      </div>
      <div className="panel p-4 sm:p-6">
        <FieldRecoveryForm
          companyId={company.id}
          organizationId={company.organization_id}
          shops={(shops || []) as Array<{
            party_id: string;
            party_code: string;
            name_en: string;
            balance: number;
          }>}
        />
      </div>
    </div>
  );
}

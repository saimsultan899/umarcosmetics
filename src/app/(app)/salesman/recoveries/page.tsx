import { RecoveriesTable } from "@/components/tables/recoveries-table";
import { requireCompanyContext } from "@/lib/auth";

export default async function SalesmanRecoveriesPage() {
  const { supabase, company } = await requireCompanyContext();
  const { data: rows } = await supabase
    .from("recoveries")
    .select("*, parties(party_code, name_en)")
    .eq("company_id", company.id)
    .order("recovery_date", { ascending: false })
    .limit(100);

  return (
    <div className="animate-rise space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          Field recoveries
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Collections synced from salesman / office recovery entry
        </p>
      </div>
      <RecoveriesTable rows={rows || []} />
    </div>
  );
}

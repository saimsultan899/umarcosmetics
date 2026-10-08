import { CompanyStatementClient } from "@/components/reports/company-statement-client";
import { requireCompanyContext } from "@/lib/auth";
import { Suspense } from "react";

export default async function CompanyStatementPage() {
  const { company, supabase, offline } = await requireCompanyContext();
  let initialWarehouses: { id: string; name: string }[] = [];
  if (!offline) {
    const warehouses = await Promise.race([
      supabase
        .from("warehouses")
        .select("id, name")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("name"),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    initialWarehouses = (warehouses?.data || []).map((row) => ({
      id: row.id,
      name: row.name || "Company",
    }));
  }

  return (
    <Suspense
      fallback={
        <p className="text-sm text-[var(--muted)]">Loading company statement…</p>
      }
    >
      <CompanyStatementClient
        companyId={company.id}
        companyName={company.name}
        initialWarehouses={initialWarehouses}
      />
    </Suspense>
  );
}

import { CopyCatalogForm } from "@/components/settings/copy-catalog-form";
import { requireCompanyContext } from "@/lib/auth";
import type { Company } from "@/lib/types/database";

export default async function CompanySettingsPage() {
  const { supabase, company } = await requireCompanyContext();

  const { data: orgCompanies } = await supabase
    .from("companies")
    .select("*")
    .eq("organization_id", company.organization_id)
    .eq("is_active", true)
    .order("name");

  return (
    <div className="animate-rise space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          Company profile
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Active workspace and optional catalog sync between your companies
        </p>
      </div>

      <div className="panel p-5">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          Current company
        </h2>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <p>
            <span className="text-[var(--muted)]">Name:</span>{" "}
            <strong>{company.name}</strong>
          </p>
          <p>
            <span className="text-[var(--muted)]">Code:</span>{" "}
            {company.code || "—"}
          </p>
          <p>
            <span className="text-[var(--muted)]">City:</span>{" "}
            {company.city || "—"}
          </p>
          <p>
            <span className="text-[var(--muted)]">Address:</span>{" "}
            {company.address || "—"}
          </p>
          <p>
            <span className="text-[var(--muted)]">Phone:</span>{" "}
            {company.phone || "—"}
          </p>
          <p>
            <span className="text-[var(--muted)]">NTN:</span>{" "}
            {company.ntn || "—"}
          </p>
        </div>
      </div>

      <div id="catalog-copy" className="panel p-5">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          Cross-company catalog copy
        </h2>
        <p className="mt-1 mb-4 text-sm text-[var(--muted)]">
          Copy product catalog (+ companies) from one distributor account to
          another under the same organization. Example: Umar Cosmetic → Ishaq
          Limited. Each company keeps its own stock, parties, and invoices.
        </p>
        {(orgCompanies || []).length >= 2 ? (
          <CopyCatalogForm
            companies={(orgCompanies || []) as Company[]}
            currentCompanyId={company.id}
          />
        ) : (
          <p className="text-sm text-[var(--muted)]">
            Need at least two companies under your organization.
          </p>
        )}
      </div>
    </div>
  );
}

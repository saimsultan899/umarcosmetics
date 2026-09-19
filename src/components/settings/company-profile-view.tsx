"use client";

import { CopyCatalogForm } from "@/components/settings/copy-catalog-form";
import { useCompanyProfile } from "@/hooks/use-company-profile";
import type { Company } from "@/lib/types/database";

export function CompanyProfileView({
  initialCompany,
  initialOrgCompanies = [],
  initialOffline = false,
}: {
  initialCompany: Company;
  initialOrgCompanies?: Company[];
  initialOffline?: boolean;
}) {
  const { company, orgCompanies, isOnline } = useCompanyProfile({
    initialCompany,
    initialOrgCompanies,
    initialOffline,
  });

  const activeCompany = company || initialCompany;

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
            <strong>{activeCompany.name}</strong>
          </p>
          <p>
            <span className="text-[var(--muted)]">Code:</span>{" "}
            {activeCompany.code || "—"}
          </p>
          <p>
            <span className="text-[var(--muted)]">City:</span>{" "}
            {activeCompany.city || "—"}
          </p>
          <p>
            <span className="text-[var(--muted)]">Address:</span>{" "}
            {activeCompany.address || "—"}
          </p>
          <p>
            <span className="text-[var(--muted)]">Phone:</span>{" "}
            {activeCompany.phone || "—"}
          </p>
          <p>
            <span className="text-[var(--muted)]">NTN:</span>{" "}
            {activeCompany.ntn || "—"}
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
        {!isOnline ? (
          <p className="text-sm text-[var(--muted)]">
            Cross-company catalog copy is an online organization feature. Reconnect to copy catalog between companies.
          </p>
        ) : (orgCompanies || []).length >= 2 ? (
          <CopyCatalogForm
            companies={(orgCompanies || []) as Company[]}
            currentCompanyId={activeCompany.id}
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

"use client";

import { ChangePasswordCard } from "@/components/settings/change-password-card";
import { CopyCatalogForm } from "@/components/settings/copy-catalog-form";
import { DesktopDownloadCard } from "@/components/settings/desktop-download-card";
import { MainCompanyHubForm } from "@/components/settings/main-company-hub-form";
import { SaleStockPolicySetting } from "@/components/settings/sale-stock-policy-setting";
import { WalkInSlipSetting } from "@/components/settings/walk-in-slip-setting";
import { useCompanyProfile } from "@/hooks/use-company-profile";
import type { Company } from "@/lib/types/database";

function ProfileFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--surface)] px-4 py-3">
      <dt className="text-[11px] font-medium tracking-wide text-[var(--muted)] uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-[var(--ink)]">{value}</dd>
    </div>
  );
}

export function CompanyProfileView({
  initialCompany,
  initialOrgCompanies = [],
  initialMainCompanyId = null,
  initialOffline = false,
}: {
  initialCompany: Company;
  initialOrgCompanies?: Company[];
  initialMainCompanyId?: string | null;
  initialOffline?: boolean;
}) {
  const { company, orgCompanies, isOnline } = useCompanyProfile({
    initialCompany,
    initialOrgCompanies,
    initialOffline,
  });

  const activeCompany = company || initialCompany;

  const facts = [
    ["Code", activeCompany.code || "—"],
    ["City", activeCompany.city || "—"],
    ["Phone", activeCompany.phone || "—"],
    ["NTN", activeCompany.ntn || "—"],
    ["Address", activeCompany.address || "—"],
  ] as const;

  return (
    <div className="animate-rise space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          Company profile
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          This workspace, your sign-in, and the Windows app
        </p>
      </div>

      <section className="panel overflow-hidden">
        <div className="flex items-center gap-4 border-b border-[var(--border)] px-5 py-4">
          <img
            src="/icons/icon-192.png"
            alt=""
            className="h-14 w-14 rounded-2xl object-cover"
          />
          <div className="min-w-0">
            <h2 className="truncate font-[family-name:var(--font-display)] text-xl font-semibold">
              {activeCompany.name}
            </h2>
            <p className="truncate text-sm text-[var(--muted)]">
              {[activeCompany.code, activeCompany.city].filter(Boolean).join(" · ") || "Active company"}
            </p>
          </div>
        </div>
        <dl className="grid gap-px bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-3">
          {facts.map(([label, value]) => (
            <ProfileFact key={label} label={label} value={value} />
          ))}
        </dl>
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <ChangePasswordCard />
        <DesktopDownloadCard />
      </div>

      <SaleStockPolicySetting
        companyId={activeCompany.id}
        initialPolicy={activeCompany.sale_stock_policy}
      />

      <WalkInSlipSetting companyId={activeCompany.id} />

      {(orgCompanies || []).length >= 2 ? (
        <div id="main-company-hub" className="panel p-5">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            Main company (shared products & shops)
          </h2>
          <p className="mt-1 mb-4 text-sm text-[var(--muted)]">
            Pick one company as main for this organization. Products, rates, and
            shops from the others sync there. Purchase stock on a sister company
            also restocks main. Sale invoices and balances stay separate.
          </p>
          {!isOnline ? (
            <p className="text-sm text-[var(--muted)]">
              Main company sync needs an online connection.
            </p>
          ) : (
            <MainCompanyHubForm
              organizationId={activeCompany.organization_id}
              companies={(orgCompanies || []) as Company[]}
              initialMainCompanyId={initialMainCompanyId}
            />
          )}
        </div>
      ) : null}

      <div id="catalog-copy" className="panel p-5">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          Cross-company catalog copy
        </h2>
        <p className="mt-1 mb-4 text-sm text-[var(--muted)]">
          One-time copy of products (+ brand companies) from one distributor
          account to another under the same organization. For ongoing shared
          stock and shops, use Main company above instead.
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

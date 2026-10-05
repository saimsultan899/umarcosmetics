import { AppShell } from "@/components/layout/app-shell";
import { ShellSkeleton } from "@/components/ui/page-skeleton";
import { effectivePermissions } from "@/lib/access/permissions";
import { getMemberships } from "@/lib/auth";
import type { Company } from "@/lib/types/database";
import { Suspense } from "react";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile, memberships, user } = await getMemberships();

  const mem = memberships.find((m) => m.company_id === profile?.active_company_id);
  const embedded = mem?.companies;
  const companyRow = Array.isArray(embedded) ? embedded[0] : embedded;
  let company: Company | null = (companyRow as Company | undefined) || null;
  if (company && "organizations" in company) {
    const { organizations: _organizations, ...rest } = company as Company & {
      organizations?: unknown;
    };
    company = rest as Company;
  }

  const activeMembership = memberships.find(
    (m) => m.company_id === (company?.id || profile?.active_company_id),
  );
  const permissions = effectivePermissions(
    activeMembership,
    Boolean(profile?.is_super_admin),
  );

  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AppShell
        company={company}
        userName={profile?.full_name || user.email || "User"}
        isSuperAdmin={profile?.is_super_admin}
        permissions={permissions}
        profileData={(profile || { id: user.id }) as unknown as Record<string, unknown>}
        membershipsData={memberships as unknown as Record<string, unknown>[]}
      >
        {children}
      </AppShell>
    </Suspense>
  );
}

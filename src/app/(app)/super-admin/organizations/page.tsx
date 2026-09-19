import { OrganizationsPanel } from "@/components/admin/organizations-panel";
import { requireSuperAdmin } from "@/lib/auth";
import type { Company, Organization } from "@/lib/types/database";

export default async function SuperAdminOrganizationsPage() {
  const { supabase, offline } = await requireSuperAdmin();
  if (offline) {
    const { renderOnlineOnlyModule } = await import(
      "@/lib/offline/render-offline-page"
    );
    return renderOnlineOnlyModule(
      "Organizations",
      "Platform management requires an active internet connection.",
    );
  }

  const [{ data: orgs }, { data: companies }] = await Promise.all([
    supabase.from("organizations").select("*").order("created_at"),
    supabase.from("companies").select("id, organization_id"),
  ]);

  const organizations = (orgs || []) as Organization[];
  const companyCounts = ((companies || []) as Pick<Company, "id" | "organization_id">[]).reduce<
    Record<string, number>
  >((acc, c) => {
    acc[c.organization_id] = (acc[c.organization_id] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="animate-rise min-w-0 space-y-4">
      <div className="action-bar action-bar--split">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold sm:text-3xl">
            Organizations
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Distributor groups that own one or more companies.
          </p>
        </div>
      </div>
      <OrganizationsPanel
        organizations={organizations}
        companyCounts={companyCounts}
      />
    </div>
  );
}

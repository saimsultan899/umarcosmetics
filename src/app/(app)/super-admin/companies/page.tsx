import { CompaniesPanel } from "@/components/admin/companies-panel";
import { requireSuperAdmin } from "@/lib/auth";
import type { Company, Organization } from "@/lib/types/database";

export default async function SuperAdminCompaniesPage() {
  const { supabase, offline } = await requireSuperAdmin();
  if (offline) {
    const { renderOnlineOnlyModule } = await import(
      "@/lib/offline/render-offline-page"
    );
    return renderOnlineOnlyModule(
      "Companies",
      "Platform management requires an active internet connection.",
    );
  }

  const [{ data: companies }, { data: orgs }] = await Promise.all([
    supabase.from("companies").select("*").order("name"),
    supabase.from("organizations").select("*").order("name"),
  ]);

  return (
    <div className="animate-rise min-w-0 space-y-4">
      <div className="action-bar action-bar--split">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold sm:text-3xl">
            Companies
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Isolated workspaces. Attach clients from Clients or New client setup.
          </p>
        </div>
      </div>
      <CompaniesPanel
        companies={(companies || []) as Company[]}
        organizations={(orgs || []) as Organization[]}
      />
    </div>
  );
}

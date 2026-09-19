import { requireSuperAdmin } from "@/lib/auth";
import type { Company, Organization } from "@/lib/types/database";
import Link from "next/link";

export default async function SuperAdminOverviewPage() {
  const { supabase, offline } = await requireSuperAdmin();
  if (offline) {
    const { renderOnlineOnlyModule } = await import(
      "@/lib/offline/render-offline-page"
    );
    return renderOnlineOnlyModule(
      "Super Admin",
      "Platform management requires an active internet connection.",
    );
  }

  const [
    { data: orgs },
    { data: companies },
    { count: memberCount },
    { count: clientCount },
  ] = await Promise.all([
    supabase.from("organizations").select("*").order("created_at", { ascending: false }),
    supabase.from("companies").select("*").order("created_at", { ascending: false }),
    supabase.from("company_members").select("*", { count: "exact", head: true }),
    supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("is_super_admin", false),
  ]);

  const organizations = (orgs || []) as Organization[];
  const companyRows = (companies || []) as Company[];
  const companyCounts = companyRows.reduce<Record<string, number>>((acc, c) => {
    acc[c.organization_id] = (acc[c.organization_id] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="animate-rise space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">
            Platform control
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold">
            Super Admin
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Create client logins, single or multi-company tenants, and manage
            the SaaS platform.
          </p>
        </div>
        <Link
          href="/super-admin/provision"
          className="inline-flex rounded-lg bg-[var(--brand)] px-4 py-2.5 text-sm font-semibold !text-white shadow-sm"
        >
          New client setup
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Organizations"
          value={organizations.length}
          href="/super-admin/organizations"
        />
        <StatTile
          label="Companies"
          value={companyRows.length}
          href="/super-admin/companies"
        />
        <StatTile
          label="Clients"
          value={clientCount || 0}
          href="/super-admin/clients"
        />
        <StatTile
          label="Memberships"
          value={memberCount || 0}
          href="/super-admin/clients"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
              Recent organizations
            </h2>
            <Link
              href="/super-admin/organizations"
              className="text-xs font-medium text-[var(--brand)]"
            >
              View all
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            {organizations.slice(0, 6).map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between rounded-xl border border-[var(--border)] px-3 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">{o.name}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {companyCounts[o.id] || 0} companies
                  </p>
                </div>
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold uppercase text-emerald-700">
                  {o.status}
                </span>
              </div>
            ))}
            {!organizations.length ? (
              <p className="text-sm text-[var(--muted)]">
                No organizations yet. Use New client setup.
              </p>
            ) : null}
          </div>
        </div>

        <div className="panel p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
              Recent companies
            </h2>
            <Link
              href="/super-admin/companies"
              className="text-xs font-medium text-[var(--brand)]"
            >
              View all
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            {companyRows.slice(0, 6).map((c) => (
              <div
                key={c.id}
                className="rounded-xl border border-[var(--border)] px-3 py-3 text-sm"
              >
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-[var(--muted)]">
                  {[c.code, c.city, c.is_active ? "Active" : "Inactive"]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            ))}
            {!companyRows.length ? (
              <p className="text-sm text-[var(--muted)]">No companies yet.</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <div className="stat-tile">
      <p className="text-xs font-semibold uppercase text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <Link
        href={href}
        className="mt-2 inline-block text-xs font-medium text-[var(--brand)]"
      >
        Manage →
      </Link>
    </div>
  );
}

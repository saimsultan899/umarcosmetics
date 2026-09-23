import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { requireSuperAdmin } from "@/lib/auth";
import type { Company, Organization } from "@/lib/types/database";
import {
  Boxes,
  Building2,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";

export default async function SuperAdminOverviewPage() {
  const { supabase, offline, profile } = await requireSuperAdmin();
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
    { count: activeCompanyCount },
    { count: suspendedOrgCount },
  ] = await Promise.all([
    supabase
      .from("organizations")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("companies")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.from("company_members").select("*", { count: "exact", head: true }),
    supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("is_super_admin", false),
    supabase
      .from("companies")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true),
    supabase
      .from("organizations")
      .select("*", { count: "exact", head: true })
      .eq("status", "suspended"),
  ]);

  const organizations = (orgs || []) as Organization[];
  const companyRows = (companies || []) as Company[];
  const orgName = Object.fromEntries(organizations.map((o) => [o.id, o.name]));
  const companyCounts = companyRows.reduce<Record<string, number>>((acc, c) => {
    acc[c.organization_id] = (acc[c.organization_id] || 0) + 1;
    return acc;
  }, {});

  const firstName =
    profile?.full_name?.trim().split(/\s+/)[0] || "Admin";
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="animate-rise min-w-0 space-y-4">
      <div className="action-bar action-bar--split">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--ink)]">
            {greeting}, {firstName}
          </p>
          <p className="text-xs text-[var(--muted)]">
            Provision tenants, clients, and companies from one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/super-admin/provision"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand)] px-3 py-2 text-xs font-semibold !text-white"
          >
            <UserPlus className="h-3.5 w-3.5" />
            New client setup
          </Link>
          <Link
            href="/super-admin/organizations"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-2)]"
          >
            <Building2 className="h-3.5 w-3.5" />
            Organizations
          </Link>
        </div>
      </div>

      <StatsGrid fluid>
        <StatCard
          label="Organizations"
          value={organizations.length}
          hint={`${suspendedOrgCount || 0} suspended`}
          icon={Building2}
          href="/super-admin/organizations"
          tone="brand"
          format="number"
        />
        <StatCard
          label="Companies"
          value={companyRows.length}
          hint={`${activeCompanyCount || 0} active`}
          icon={Boxes}
          href="/super-admin/companies"
          tone="ok"
          format="number"
        />
        <StatCard
          label="Clients"
          value={clientCount || 0}
          hint="Owner logins"
          icon={Users}
          href="/super-admin/clients"
          tone="brand"
          format="number"
        />
        <StatCard
          label="Memberships"
          value={memberCount || 0}
          hint="Company access rows"
          icon={ShieldCheck}
          href="/super-admin/clients"
          tone="neutral"
          format="number"
        />
      </StatsGrid>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-4">
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
                Recent organizations
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Latest distributor groups on the platform
              </p>
            </div>
            <Link
              href="/super-admin/organizations"
              className="text-xs font-semibold text-[var(--brand)]"
            >
              View all
            </Link>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {organizations.slice(0, 6).map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between gap-3 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-[var(--ink)]">
                    {o.name}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {companyCounts[o.id] || 0} compan
                    {(companyCounts[o.id] || 0) === 1 ? "y" : "ies"}
                    {" · "}
                    {new Date(o.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span
                  className={
                    o.status === "active"
                      ? "rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700"
                      : "rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800"
                  }
                >
                  {o.status}
                </span>
              </div>
            ))}
            {!organizations.length ? (
              <p className="px-5 py-8 text-sm text-[var(--muted)]">
                No organizations yet. Start with New client setup.
              </p>
            ) : null}
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-4">
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
                Recent companies
              </h2>
              <p className="text-xs text-[var(--muted)]">
                Workspaces ready for client owners
              </p>
            </div>
            <Link
              href="/super-admin/companies"
              className="text-xs font-semibold text-[var(--brand)]"
            >
              View all
            </Link>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {companyRows.slice(0, 6).map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-[var(--ink)]">
                    {c.name}
                  </p>
                  <p className="truncate text-xs text-[var(--muted)]">
                    {[orgName[c.organization_id], c.city, c.code]
                      .filter(Boolean)
                      .join(" · ") || "No details"}
                  </p>
                </div>
                <span
                  className={
                    c.is_active
                      ? "rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700"
                      : "rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-700"
                  }
                >
                  {c.is_active ? "Active" : "Inactive"}
                </span>
              </div>
            ))}
            {!companyRows.length ? (
              <p className="px-5 py-8 text-sm text-[var(--muted)]">
                No companies yet.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <section className="panel p-5">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          Quick actions
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <QuickAction
            href="/super-admin/provision"
            title="Provision client"
            description="Org + companies + owner login in one wizard"
          />
          <QuickAction
            href="/super-admin/clients"
            title="Manage clients"
            description="Reset passwords, disable access, attach companies"
          />
          <QuickAction
            href="/super-admin/companies"
            title="Open company"
            description="Jump into a tenant workspace as support"
          />
        </div>
      </section>
    </div>
  );
}

function QuickAction({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 transition hover:border-[var(--brand)] hover:bg-white"
    >
      <p className="text-sm font-semibold text-[var(--ink)]">{title}</p>
      <p className="mt-1 text-xs text-[var(--muted)]">{description}</p>
    </Link>
  );
}

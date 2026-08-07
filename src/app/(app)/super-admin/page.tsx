import { CompaniesPanel } from "@/components/admin/companies-panel";
import { OrganizationsPanel } from "@/components/admin/organizations-panel";
import { requireUser } from "@/lib/auth";
import type { Company, Organization } from "@/lib/types/database";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { redirect } from "next/navigation";

type Tab = "overview" | "orgs" | "companies";

function resolveTab(raw: string | string[] | undefined): Tab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "orgs" || value === "companies") return value;
  return "overview";
}

export default async function SuperAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile?.is_super_admin) redirect("/dashboard");

  const params = await searchParams;
  const tab = resolveTab(params.tab);

  const [{ data: orgs }, { data: companies }, { count: memberCount }] =
    await Promise.all([
      supabase.from("organizations").select("*").order("created_at"),
      supabase.from("companies").select("*").order("name"),
      supabase
        .from("company_members")
        .select("*", { count: "exact", head: true }),
    ]);

  const organizations = (orgs || []) as Organization[];
  const companyRows = (companies || []) as Company[];
  const companyCounts = companyRows.reduce<Record<string, number>>((acc, c) => {
    acc[c.organization_id] = (acc[c.organization_id] || 0) + 1;
    return acc;
  }, {});

  const tabs: Array<{ id: Tab; label: string; href: string }> = [
    { id: "overview", label: "Overview", href: "/super-admin" },
    { id: "orgs", label: "Organizations", href: "/super-admin?tab=orgs" },
    {
      id: "companies",
      label: "Companies",
      href: "/super-admin?tab=companies",
    },
  ];

  const title =
    tab === "orgs"
      ? "Organizations"
      : tab === "companies"
        ? "Companies"
        : "Super Admin";
  const description =
    tab === "orgs"
      ? "Create, edit, and suspend distributor organizations."
      : tab === "companies"
        ? "Create isolated companies under an organization — each gets its own dashboard."
        : "Platform control for organizations, companies, and memberships.";

  return (
    <div className="animate-rise space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">
          Platform control
        </p>
        <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold">
          {title}
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">{description}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition",
              tab === t.id
                ? "bg-[var(--brand)] !text-white"
                : "bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--ink)]",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "overview" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="stat-tile">
              <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                Organizations
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {organizations.length}
              </p>
              <Link
                href="/super-admin?tab=orgs"
                className="mt-2 inline-block text-xs font-medium text-[var(--brand)]"
              >
                Manage →
              </Link>
            </div>
            <div className="stat-tile">
              <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                Companies
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {companyRows.length}
              </p>
              <Link
                href="/super-admin?tab=companies"
                className="mt-2 inline-block text-xs font-medium text-[var(--brand)]"
              >
                Manage →
              </Link>
            </div>
            <div className="stat-tile">
              <p className="text-xs font-semibold uppercase text-[var(--muted)]">
                Memberships
              </p>
              <p className="mt-2 text-2xl font-semibold">{memberCount || 0}</p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="panel p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
                  Recent organizations
                </h2>
                <Link
                  href="/super-admin?tab=orgs"
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
                    No organizations yet.
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
                  href="/super-admin?tab=companies"
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
                  <p className="text-sm text-[var(--muted)]">
                    No companies yet.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : null}

      {tab === "orgs" ? (
        <OrganizationsPanel
          organizations={organizations}
          companyCounts={companyCounts}
        />
      ) : null}

      {tab === "companies" ? (
        <CompaniesPanel
          companies={companyRows}
          organizations={organizations}
        />
      ) : null}
    </div>
  );
}

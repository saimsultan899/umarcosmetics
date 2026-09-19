"use client";

import {
  CompanyPicker,
  type CompanyMembership,
} from "@/components/auth/company-picker";
import { createClient } from "@/lib/supabase/client";
import {
  getPreferredCompanyId,
  setPreferredCompanyId,
} from "@/lib/company-preference";
import { getCachedSessionData } from "@/lib/offline/cache-manager";
import {
  isAppOnline,
  setOfflineSessionCookie,
} from "@/lib/offline/local-auth";
import {
  clearOfflineShellCookie,
  readOfflineShellCookie,
  writeOfflineShellCookie,
  type OfflineShellSnapshot,
} from "@/lib/offline/offline-shell";
import type { AppRole, Company } from "@/lib/types/database";
import { Layers3, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

function stubCompany(
  partial: {
    id: string;
    name: string;
    organization_id?: string;
    city?: string | null;
    address?: string | null;
  },
  savedAt: string,
): Company {
  return {
    id: partial.id,
    organization_id: partial.organization_id || "",
    name: partial.name,
    code: null,
    address: partial.address ?? null,
    city: partial.city ?? null,
    phone: null,
    ntn: null,
    logo_url: null,
    is_active: true,
    created_at: savedAt,
    updated_at: savedAt,
  };
}

function membershipsFromShell(
  shell: OfflineShellSnapshot,
): CompanyMembership[] {
  return shell.memberships
    .filter((m) => m.companies?.id)
    .map((m) => {
      const companyId = m.company_id || m.companies!.id;
      return {
        id: `offline-${companyId}`,
        company_id: companyId,
        user_id: shell.userId,
        role: (m.role || "staff") as AppRole,
        is_active: true,
        created_at: shell.savedAt,
        updated_at: shell.savedAt,
        companies: stubCompany(
          {
            id: m.companies!.id,
            name: m.companies!.name,
            organization_id: m.companies!.organization_id,
            city: m.companies!.city,
          },
          shell.savedAt,
        ),
      };
    });
}

function membershipsFromCache(
  userId: string,
  memberships: Record<string, unknown>[],
): CompanyMembership[] {
  const savedAt = new Date().toISOString();
  return memberships
    .map((m, index) => {
      const companies = m.companies as Record<string, unknown> | null | undefined;
      const companyId = String(
        m.company_id || companies?.id || "",
      );
      if (!companyId && !companies?.id) return null;
      const id = String(companies?.id || companyId);
      return {
        id: String(m.id || `cached-${id}-${index}`),
        company_id: companyId || id,
        user_id: String(m.user_id || userId),
        role: String(m.role || "staff") as AppRole,
        is_active: m.is_active !== false,
        created_at: String(m.created_at || savedAt),
        updated_at: String(m.updated_at || savedAt),
        companies: stubCompany(
          {
            id,
            name: String(companies?.name || "Company"),
            organization_id:
              companies?.organization_id == null
                ? undefined
                : String(companies.organization_id),
            city:
              companies?.city == null ? null : String(companies.city),
            address:
              companies?.address == null
                ? null
                : String(companies.address),
          },
          savedAt,
        ),
      } satisfies CompanyMembership;
    })
    .filter(Boolean) as CompanyMembership[];
}

function applyOfflinePick(
  companyId: string,
  rows: CompanyMembership[],
  base?: OfflineShellSnapshot | null,
) {
  const membership = rows.find((r) => r.companies?.id === companyId);
  const existing = base || readOfflineShellCookie();
  const companies = membership?.companies;
  const snapshot: OfflineShellSnapshot = {
    userId: existing?.userId || membership?.user_id || "offline-user",
    email: existing?.email || "",
    fullName: existing?.fullName || existing?.email || "User",
    activeCompanyId: companyId,
    isSuperAdmin: existing?.isSuperAdmin || false,
    company: companies
      ? {
          id: companies.id,
          name: companies.name,
          organization_id: companies.organization_id || "",
          city: companies.city,
        }
      : null,
    memberships:
      existing?.memberships?.length
        ? existing.memberships
        : rows.map((r) => ({
            company_id: r.company_id,
            role: r.role,
            companies: r.companies
              ? {
                  id: r.companies.id,
                  name: r.companies.name,
                  organization_id: r.companies.organization_id,
                  city: r.companies.city,
                }
              : null,
          })),
    savedAt: new Date().toISOString(),
  };
  writeOfflineShellCookie(snapshot);
  setOfflineSessionCookie(true);
  return membership;
}

export default function SelectCompanyPage() {
  const router = useRouter();
  const [rows, setRows] = useState<CompanyMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [userLabel, setUserLabel] = useState<string>("");
  const [preferredId, setPreferredId] = useState<string | null>(null);

  useEffect(() => {
    setPreferredId(getPreferredCompanyId());

    async function loadOfflineFallback() {
      const shell = readOfflineShellCookie();
      if (shell?.memberships?.length) {
        setUserLabel(shell.fullName || shell.email || "Signed in");
        setIsSuperAdmin(shell.isSuperAdmin);
        setRows(membershipsFromShell(shell));
        // Clear working company locally so sidebar stays hidden until pick
        writeOfflineShellCookie({
          ...shell,
          activeCompanyId: null,
          company: null,
          savedAt: new Date().toISOString(),
        });
        setOfflineSessionCookie(true);
        setLoading(false);
        return true;
      }

      const cached = await getCachedSessionData();
      if (cached?.memberships?.length) {
        const profile = cached.profile;
        setUserLabel(
          String(profile.full_name || profile.email || "Signed in"),
        );
        setIsSuperAdmin(Boolean(profile.is_super_admin));
        setRows(membershipsFromCache(cached.userId, cached.memberships));
        setOfflineSessionCookie(true);
        setLoading(false);
        return true;
      }

      return false;
    }

    async function load() {
      const online = await isAppOnline();

      if (!online) {
        const ok = await loadOfflineFallback();
        if (!ok) {
          setError(
            "No saved companies for offline use. Connect once to sync, then try again.",
          );
          setLoading(false);
        }
        return;
      }

      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          const ok = await loadOfflineFallback();
          if (!ok) router.push("/login");
          return;
        }

        setUserLabel(user.email || "Signed in");

        await supabase.rpc("clear_active_company");

        const { data: profile } = await supabase
          .from("profiles")
          .select("is_super_admin, full_name")
          .eq("id", user.id)
          .single();

        setIsSuperAdmin(Boolean(profile?.is_super_admin));
        if (profile?.full_name) setUserLabel(profile.full_name);

        const { data, error: qError } = await supabase
          .from("company_members")
          .select("*, companies(*, organizations(status))")
          .eq("user_id", user.id)
          .eq("is_active", true);

        if (qError) {
          const ok = await loadOfflineFallback();
          if (!ok) setError(qError.message);
          return;
        }

        const usable = ((data as CompanyMembership[]) || []).filter((m) => {
          const c = m.companies as
            | (NonNullable<CompanyMembership["companies"]> & {
                is_active?: boolean;
                organizations?:
                  | { status?: string }
                  | { status?: string }[]
                  | null;
              })
            | null
            | undefined;
          if (!c || c.is_active === false) return false;
          const org = Array.isArray(c.organizations)
            ? c.organizations[0]
            : c.organizations;
          return org?.status !== "suspended";
        });

        setRows(usable);
        setLoading(false);
      } catch (err) {
        const ok = await loadOfflineFallback();
        if (!ok) {
          setError(
            err instanceof Error ? err.message : "Failed to load companies",
          );
          setLoading(false);
        }
      }
    }
    void load();
  }, [router]);

  async function pick(companyId: string) {
    setPicking(companyId);
    setError(null);
    const online = await isAppOnline();

    if (!online) {
      const membership = applyOfflinePick(companyId, rows);
      setPreferredCompanyId(companyId);
      setPicking(null);
      router.push(membership?.role === "salesman" ? "/field" : "/dashboard");
      router.refresh();
      return;
    }

    try {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("set_active_company", {
        p_company_id: companyId,
      });
      if (rpcError) {
        // Network blip: still allow offline pick from cached list
        const membership = applyOfflinePick(companyId, rows);
        setPreferredCompanyId(companyId);
        setPicking(null);
        if (!membership) {
          setError(rpcError.message);
          return;
        }
        router.push(membership.role === "salesman" ? "/field" : "/dashboard");
        router.refresh();
        return;
      }

      applyOfflinePick(companyId, rows);
      setPreferredCompanyId(companyId);
      setPicking(null);
      const membership = rows.find((r) => r.companies?.id === companyId);
      router.push(membership?.role === "salesman" ? "/field" : "/dashboard");
      router.refresh();
    } catch (err) {
      const membership = applyOfflinePick(companyId, rows);
      setPreferredCompanyId(companyId);
      setPicking(null);
      if (!membership) {
        setError(err instanceof Error ? err.message : "Failed to open company");
        return;
      }
      router.push(membership.role === "salesman" ? "/field" : "/dashboard");
      router.refresh();
    }
  }

  async function signOut() {
    setOfflineSessionCookie(false);
    clearOfflineShellCookie();
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      /* offline sign-out */
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="relative min-h-screen px-4 pb-16 pt-16 sm:px-6 sm:pb-20 sm:pt-20 lg:px-8">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 top-10 h-72 w-72 rounded-full bg-[#d65a42]/12 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-[#e88774]/10 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-4xl animate-rise">
        <div className="mb-10 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3 sm:items-center">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand)] text-white shadow-lg shadow-[#c04a34]/20">
              <Layers3 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">
                Multi-company access
              </p>
              <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold text-[var(--ink)]">
                Choose working company
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
                Pick a company to open its dashboard. Sidebar and menus appear
                after you select.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isSuperAdmin ? (
              <a
                href="/super-admin"
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand)] px-3 py-2 text-sm font-semibold !text-white"
              >
                Super Admin
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--muted)] hover:text-[var(--ink)]"
            >
              <LogOut className="h-4 w-4" />
              {userLabel}
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-[var(--muted)]">Loading companies...</p>
        ) : null}

        {error ? (
          <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {!loading ? (
          <CompanyPicker
            rows={rows}
            picking={picking}
            preferredId={preferredId}
            onPick={(id) => void pick(id)}
          />
        ) : null}

        {!loading && rows.length === 0 ? (
          <div className="panel mt-4 p-6 text-sm text-[var(--muted)]">
            No company membership found.{" "}
            {isSuperAdmin ? (
              <a className="font-semibold text-[var(--brand)]" href="/super-admin">
                Open Super Admin
              </a>
            ) : (
              <a className="font-semibold text-[var(--brand)]" href="/setup">
                Run setup
              </a>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

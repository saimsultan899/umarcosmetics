import { createClient } from "@/lib/supabase/server";
import {
  getVerifiedAuthUser,
  type VerifiedAuthUser,
} from "@/lib/supabase/session";
import type { Company, CompanyMember, Profile } from "@/lib/types/database";
import {
  decodeOfflineShell,
  OFFLINE_OK_COOKIE,
  OFFLINE_SHELL_COOKIE,
  type OfflineShellSnapshot,
} from "@/lib/offline/offline-shell";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type AuthUser = VerifiedAuthUser;

async function readOfflineShell(): Promise<OfflineShellSnapshot | null> {
  const jar = await cookies();
  if (jar.get(OFFLINE_OK_COOKIE)?.value !== "1") return null;
  return decodeOfflineShell(jar.get(OFFLINE_SHELL_COOKIE)?.value);
}

/** Shell cookie only — used when cloud auth/data times out offline. */
async function readShellCookieOnly(): Promise<OfflineShellSnapshot | null> {
  const jar = await cookies();
  return decodeOfflineShell(jar.get(OFFLINE_SHELL_COOKIE)?.value);
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T | null> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function userFromShell(shell: OfflineShellSnapshot): VerifiedAuthUser {
  return {
    id: shell.userId,
    email: shell.email,
    role: "authenticated",
    aal: null,
    sessionId: null,
  };
}

function profileFromShell(shell: OfflineShellSnapshot): Profile {
  return {
    id: shell.userId,
    full_name: shell.fullName,
    active_company_id: shell.activeCompanyId,
    is_super_admin: shell.isSuperAdmin,
  } as Profile;
}

function membershipsFromShell(shell: OfflineShellSnapshot): CompanyMember[] {
  return shell.memberships.map((m) => ({
    company_id: m.company_id,
    role: m.role,
    user_id: shell.userId,
    is_active: true,
    companies: m.companies as CompanyMember["companies"],
  })) as CompanyMember[];
}

export async function requireUser() {
  const shell = await readOfflineShell();
  if (shell) {
    const supabase = await createClient();
    return { supabase, user: userFromShell(shell), offline: true as const };
  }

  const supabase = await createClient();
  let user: VerifiedAuthUser | null = null;
  try {
    user = await withTimeout(getVerifiedAuthUser(supabase), 5000);
  } catch {
    user = null;
  }

  if (!user) {
    const fallback = await readShellCookieOnly();
    if (fallback) {
      return { supabase, user: userFromShell(fallback), offline: true as const };
    }
    redirect("/login");
  }
  return { supabase, user, offline: false as const };
}

export async function getProfile() {
  const shell = await readOfflineShell();
  if (shell) {
    const supabase = await createClient();
    return {
      supabase,
      user: userFromShell(shell),
      profile: profileFromShell(shell),
      offline: true as const,
    };
  }

  const { supabase, user, offline } = await requireUser();
  if (offline) {
    const fallback = await readShellCookieOnly();
    if (fallback) {
      return {
        supabase,
        user,
        profile: profileFromShell(fallback),
        offline: true as const,
      };
    }
  }

  const result = await withTimeout(
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    5000,
  );

  if (!result?.data) {
    const fallback = await readShellCookieOnly();
    if (fallback) {
      return {
        supabase,
        user: userFromShell(fallback),
        profile: profileFromShell(fallback),
        offline: true as const,
      };
    }
  }

  return {
    supabase,
    user,
    profile: (result?.data as Profile | null) || null,
    offline: false as const,
  };
}

export async function getMemberships() {
  const shell = await readOfflineShell();
  if (shell) {
    const supabase = await createClient();
    return {
      supabase,
      user: userFromShell(shell),
      profile: profileFromShell(shell),
      memberships: membershipsFromShell(shell),
      offline: true as const,
    };
  }

  const { supabase, user, profile, offline } = await getProfile();
  if (offline) {
    const fallback = await readShellCookieOnly();
    return {
      supabase,
      user,
      profile,
      memberships: fallback ? membershipsFromShell(fallback) : [],
      offline: true as const,
    };
  }

  const result = await withTimeout(
    supabase
      .from("company_members")
      .select("*, companies(*, organizations(status))")
      .eq("user_id", user.id)
      .eq("is_active", true),
    5000,
  );

  if (!result) {
    const fallback = await readShellCookieOnly();
    if (fallback) {
      return {
        supabase,
        user: userFromShell(fallback),
        profile: profileFromShell(fallback),
        memberships: membershipsFromShell(fallback),
        offline: true as const,
      };
    }
  }

  const raw = (result?.data || []) as CompanyMember[];
  const memberships = raw.filter((m) => {
    const company = m.companies as
      | (Company & {
          organizations?: { status?: string } | { status?: string }[] | null;
        })
      | null
      | undefined;
    if (!company || company.is_active === false) return false;
    const org = Array.isArray(company.organizations)
      ? company.organizations[0]
      : company.organizations;
    if (org?.status === "suspended") return false;
    return true;
  });

  return {
    supabase,
    user,
    profile,
    memberships,
    offline: false as const,
  };
}

/** Platform SaaS console — requires online + profiles.is_super_admin. */
export async function requireSuperAdmin() {
  const { supabase, user, offline } = await requireUser();
  if (offline) {
    return {
      supabase,
      user,
      profile: null as Profile | null,
      offline: true as const,
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile?.is_super_admin) {
    redirect("/dashboard");
  }

  return {
    supabase,
    user,
    profile: profile as Profile,
    offline: false as const,
  };
}

export async function requireCompanyContext() {
  const ctx = await getMemberships();
  const { profile, memberships, supabase, offline } = ctx;

  if (profile?.is_super_admin && !profile.active_company_id) {
    // Super admin can still open super-admin without company
  }

  if (!profile?.active_company_id) {
    if (profile?.is_super_admin) redirect("/super-admin");
    redirect("/select-company");
  }

  if (offline) {
    const shell = (await readOfflineShell()) || (await readShellCookieOnly());
    const company =
      (shell?.company as Company | null) ||
      (memberships.find((m) => m.company_id === profile.active_company_id)
        ?.companies as Company | undefined) ||
      null;
    if (!company) redirect("/select-company");
    const membership = memberships.find((m) => m.company_id === company.id);
    return {
      ...ctx,
      company,
      membership,
      offline: true as const,
    };
  }

  const result = await withTimeout(
    supabase
      .from("companies")
      .select("*, organizations(status)")
      .eq("id", profile.active_company_id)
      .single(),
    5000,
  );

  if (!result?.data) {
    const shell = await readShellCookieOnly();
    if (shell) {
      const company =
        (shell.company as Company | null) ||
        (memberships.find((m) => m.company_id === profile.active_company_id)
          ?.companies as Company | undefined) ||
        null;
      if (!company) redirect("/select-company");
      const membership = memberships.find((m) => m.company_id === company.id);
      return {
        ...ctx,
        company,
        membership,
        offline: true as const,
        user: userFromShell(shell),
        profile: profileFromShell(shell),
        memberships: membershipsFromShell(shell),
      };
    }
    redirect("/select-company");
  }

  const company = result.data as Company & {
    organizations?: { status?: string } | { status?: string }[] | null;
  };
  const orgRel = Array.isArray(company.organizations)
    ? company.organizations[0]
    : company.organizations;
  const orgSuspended = orgRel?.status === "suspended";

  if (!company.is_active || orgSuspended) {
    try {
      await supabase.rpc("clear_active_company");
    } catch {
      /* best-effort: cookie/redirect below still enforces the guard */
    }
    if (profile?.is_super_admin) redirect("/super-admin");
    redirect("/select-company");
  }

  const membership = memberships.find((m) => m.company_id === company.id);

  return {
    ...ctx,
    company,
    membership,
    offline: false as const,
  };
}

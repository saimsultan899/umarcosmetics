import { createClient } from "@/lib/supabase/server";
import {
  getVerifiedAuthUser,
  type VerifiedAuthUser,
} from "@/lib/supabase/session";
import type { Company, CompanyMember, Profile } from "@/lib/types/database";
import { redirect } from "next/navigation";

export type AuthUser = VerifiedAuthUser;

export async function requireUser() {
  const supabase = await createClient();
  const user = await getVerifiedAuthUser(supabase);

  if (!user) redirect("/login");
  return { supabase, user };
}

export async function getProfile() {
  const { supabase, user } = await requireUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return { supabase, user, profile: profile as Profile | null };
}

export async function getMemberships() {
  const { supabase, user, profile } = await getProfile();

  const { data: memberships } = await supabase
    .from("company_members")
    .select("*, companies(*)")
    .eq("user_id", user.id)
    .eq("is_active", true);

  return {
    supabase,
    user,
    profile,
    memberships: (memberships || []) as CompanyMember[],
  };
}

export async function requireCompanyContext() {
  const ctx = await getMemberships();
  const { profile, memberships, supabase } = ctx;

  if (profile?.is_super_admin && !profile.active_company_id) {
    // Super admin can still open super-admin without company
  }

  if (!profile?.active_company_id) {
    redirect("/select-company");
  }

  const { data: company } = await supabase
    .from("companies")
    .select("*")
    .eq("id", profile.active_company_id)
    .single();

  if (!company) redirect("/select-company");

  const membership = memberships.find((m) => m.company_id === company.id);

  return {
    ...ctx,
    company: company as Company,
    membership,
  };
}

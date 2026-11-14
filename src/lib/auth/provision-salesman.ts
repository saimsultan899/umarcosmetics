import { isPermissionKey } from "@/lib/access/permissions";
import type { SupabaseClient } from "@supabase/supabase-js";

type AdminClient = SupabaseClient;

export function cleanList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = String(item || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function cleanPermissions(value: unknown) {
  if (value == null) return null;
  if (!Array.isArray(value)) throw new Error("Permissions are invalid.");
  const unknown = value.filter((key) => !isPermissionKey(String(key)));
  if (unknown.length) throw new Error("Permissions are invalid.");
  return value.map(String).filter(isPermissionKey);
}

/** Create a confirmed login, or return an existing auth user without changing their password yet. */
export async function openConfirmedLogin(
  admin: AdminClient,
  input: { email: string; password: string; fullName: string },
) {
  const email = input.email.trim().toLowerCase();
  const created = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });
  if (created.data.user && !created.error) {
    return { userId: created.data.user.id, created: true };
  }

  const message = created.error?.message || "Could not create the login.";
  if (!/already|registered|exists/i.test(message)) {
    throw new Error(message);
  }

  const { data: existingId, error: lookupError } = await admin.rpc(
    "lookup_auth_user_id",
    { p_email: email },
  );
  if (lookupError) throw new Error(lookupError.message);
  const userId = existingId ? String(existingId) : "";
  if (!userId) throw new Error("That email already has a login.");
  return { userId, created: false };
}

export async function confirmExistingLogin(
  admin: AdminClient,
  input: { userId: string; password: string; fullName: string },
) {
  const { error } = await admin.auth.admin.updateUserById(input.userId, {
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });
  if (error) throw new Error(error.message);
}

export async function attachSalesmanAccess(
  admin: AdminClient,
  input: {
    userId: string;
    companyId: string;
    organizationId: string;
    fullName: string;
    phone?: string | null;
    permissions: string[] | null;
    routes: string[];
    cities: string[];
    salesmanId?: string | null;
    /** Invite claim may turn a plain member into a salesman. Admin create must not overwrite another role. */
    allowRoleChange: boolean;
  },
) {
  const { data: existingMember } = await admin
    .from("company_members")
    .select("id, role")
    .eq("company_id", input.companyId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (
    existingMember &&
    existingMember.role !== "salesman" &&
    !input.allowRoleChange
  ) {
    throw new Error("That email already belongs to a company user.");
  }

  const profilePatch = {
    full_name: input.fullName,
    phone: input.phone || null,
    organization_id: input.organizationId,
    active_company_id: input.companyId,
    is_super_admin: false,
  };
  const { data: profileRows, error: profileError } = await admin
    .from("profiles")
    .update(profilePatch)
    .eq("id", input.userId)
    .select("id");
  if (profileError) throw new Error(profileError.message);
  if (!profileRows?.length) {
    const { error: insertError } = await admin.from("profiles").insert({
      id: input.userId,
      ...profilePatch,
    });
    if (insertError) throw new Error(insertError.message);
  }

  if (existingMember) {
    const { error } = await admin
      .from("company_members")
      .update({
        role: "salesman",
        is_active: true,
        permissions: input.permissions,
      })
      .eq("id", existingMember.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin.from("company_members").insert({
      company_id: input.companyId,
      user_id: input.userId,
      role: "salesman",
      is_active: true,
      permissions: input.permissions,
    });
    if (error) throw new Error(error.message);
  }

  await linkSalesmanRoster(admin, input);

  const routeRows = [
    ...input.routes.map((route) => ({
      organization_id: input.organizationId,
      company_id: input.companyId,
      user_id: input.userId,
      route,
      city: null,
    })),
    ...input.cities.map((city) => ({
      organization_id: input.organizationId,
      company_id: input.companyId,
      user_id: input.userId,
      route: null,
      city,
    })),
  ];
  if (routeRows.length) {
    const { error } = await admin
      .from("salesman_routes")
      .upsert(routeRows, {
        onConflict: "company_id,user_id,route,city",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(error.message);
  }
}

async function linkSalesmanRoster(
  admin: AdminClient,
  input: {
    userId: string;
    companyId: string;
    organizationId: string;
    fullName: string;
    phone?: string | null;
    salesmanId?: string | null;
  },
) {
  if (input.salesmanId) {
    const { data: row, error } = await admin
      .from("salesmen")
      .select("id, user_id")
      .eq("id", input.salesmanId)
      .eq("company_id", input.companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("That salesman was not found.");
    if (row.user_id && row.user_id !== input.userId) {
      throw new Error("This salesman already has a login.");
    }
    const { error: updateError } = await admin
      .from("salesmen")
      .update({
        user_id: input.userId,
        full_name: input.fullName,
        phone: input.phone || null,
        is_active: true,
      })
      .eq("id", row.id);
    if (updateError) throw new Error(updateError.message);
    return;
  }

  const { data: named, error: namedError } = await admin
    .from("salesmen")
    .select("id, user_id")
    .eq("company_id", input.companyId)
    .ilike("full_name", input.fullName)
    .limit(1)
    .maybeSingle();
  if (namedError) throw new Error(namedError.message);
  if (named && !named.user_id) {
    const { error } = await admin
      .from("salesmen")
      .update({
        user_id: input.userId,
        phone: input.phone || null,
        is_active: true,
      })
      .eq("id", named.id);
    if (error) throw new Error(error.message);
    return;
  }
  if (named?.user_id === input.userId) return;

  const { error: insertError } = await admin.from("salesmen").insert({
    organization_id: input.organizationId,
    company_id: input.companyId,
    full_name: input.fullName,
    phone: input.phone || null,
    user_id: input.userId,
    is_active: true,
  });
  if (insertError) throw new Error(insertError.message);
}

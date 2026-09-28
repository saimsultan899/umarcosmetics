import {
  effectivePermissions,
  hasPermission,
  isPermissionKey,
} from "@/lib/access/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getVerifiedAuthUser } from "@/lib/supabase/session";
import type { AppRole } from "@/lib/types/database";
import { NextResponse } from "next/server";

const ASSIGNABLE = new Set<AppRole>([
  "company_admin",
  "accountant",
  "inventory",
  "sales_desk",
  "salesman",
  "viewer",
  "org_admin",
]);

export async function POST(request: Request) {
  const supabase = await createClient();
  let userId: string | null = null;
  try {
    userId = (await getVerifiedAuthUser(supabase))?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) {
    return NextResponse.json({ error: "Sign in again, then add the user." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    companyId?: string;
    fullName?: string;
    phone?: string;
    email?: string;
    password?: string;
    role?: string;
    permissions?: string[] | null;
  } | null;

  const companyId = body?.companyId?.trim() || "";
  const fullName = body?.fullName?.trim() || "";
  const email = body?.email?.trim().toLowerCase() || "";
  const password = body?.password || "";
  const phone = body?.phone?.trim() || "";
  const role = body?.role as AppRole;

  if (!companyId || !fullName || !email || !password) {
    return NextResponse.json(
      { error: "Name, email, and password are required." },
      { status: 400 },
    );
  }
  if (!email.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }
  if (!ASSIGNABLE.has(role)) {
    return NextResponse.json({ error: "Choose a role for this user." }, { status: 400 });
  }

  let permissions: string[] | null = null;
  if (body?.permissions != null) {
    if (!Array.isArray(body.permissions)) {
      return NextResponse.json({ error: "Permissions are invalid." }, { status: 400 });
    }
    const unknown = body.permissions.filter((key) => !isPermissionKey(key));
    if (unknown.length) {
      return NextResponse.json({ error: "Permissions are invalid." }, { status: 400 });
    }
    permissions = body.permissions.filter(isPermissionKey);
  }

  const { data: member } = await supabase
    .from("company_members")
    .select("role, permissions, is_active")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  const allowed = hasPermission(
    effectivePermissions(
      member
        ? {
            role: member.role,
            permissions: (member.permissions as string[] | null) ?? null,
          }
        : null,
    ),
    "manage_users",
  );
  if (!allowed) {
    return NextResponse.json(
      { error: "You cannot add users for this company." },
      { status: 403 },
    );
  }

  const { data: company } = await supabase
    .from("companies")
    .select("id, organization_id")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) {
    return NextResponse.json({ error: "Company was not found." }, { status: 404 });
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "User creation is not configured on the server." },
      { status: 500 },
    );
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createError || !created.user) {
    const message = createError?.message || "Could not create the user.";
    if (/already|registered|exists/i.test(message)) {
      return NextResponse.json(
        { error: "That email already has a login. Use a different email." },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const newUserId = created.user.id;

  const profilePatch = {
    full_name: fullName,
    phone: phone || null,
    organization_id: company.organization_id,
    active_company_id: company.id,
    is_super_admin: false,
  };
  const { data: profileRows, error: profileError } = await admin
    .from("profiles")
    .update(profilePatch)
    .eq("id", newUserId)
    .select("id");

  if (profileError) {
    await admin.auth.admin.deleteUser(newUserId);
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }
  if (!profileRows?.length) {
    const { error: insertError } = await admin.from("profiles").insert({
      id: newUserId,
      ...profilePatch,
    });
    if (insertError) {
      await admin.auth.admin.deleteUser(newUserId);
      return NextResponse.json({ error: insertError.message }, { status: 400 });
    }
  }

  const { error: memberError } = await admin.from("company_members").insert({
    company_id: company.id,
    user_id: newUserId,
    role,
    is_active: true,
    permissions,
  });

  if (memberError) {
    await admin.auth.admin.deleteUser(newUserId);
    return NextResponse.json({ error: memberError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, email, fullName });
}

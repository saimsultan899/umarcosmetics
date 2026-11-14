import {
  effectivePermissions,
  hasPermission,
} from "@/lib/access/permissions";
import {
  attachSalesmanAccess,
  cleanList,
  cleanPermissions,
  confirmExistingLogin,
  openConfirmedLogin,
} from "@/lib/auth/provision-salesman";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { readAuthCookieUser } from "@/lib/supabase/session";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  let userId: string | null = null;
  try {
    const jar = await cookies();
    userId = readAuthCookieUser(jar.getAll())?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) {
    return NextResponse.json({ error: "Sign in again, then create the login." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    companyId?: string;
    fullName?: string;
    phone?: string;
    email?: string;
    password?: string;
    permissions?: string[] | null;
    routes?: string[];
    cities?: string[];
    salesmanId?: string;
  } | null;

  const companyId = body?.companyId?.trim() || "";
  const fullName = body?.fullName?.trim() || "";
  const email = body?.email?.trim().toLowerCase() || "";
  const password = body?.password || "";
  const phone = body?.phone?.trim() || "";

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

  let permissions: string[] | null = null;
  try {
    permissions = cleanPermissions(body?.permissions);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Permissions are invalid." },
      { status: 400 },
    );
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
      { error: "You cannot create logins for this company." },
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

  let newUserId = "";
  let createdLogin = false;
  try {
    const opened = await openConfirmedLogin(admin, { email, password, fullName });
    newUserId = opened.userId;
    createdLogin = opened.created;
    await attachSalesmanAccess(admin, {
      userId: newUserId,
      companyId: company.id,
      organizationId: company.organization_id,
      fullName,
      phone,
      permissions,
      routes: cleanList(body?.routes),
      cities: cleanList(body?.cities),
      salesmanId: body?.salesmanId || null,
      allowRoleChange: false,
    });
    if (!createdLogin) {
      await confirmExistingLogin(admin, { userId: newUserId, password, fullName });
    }
  } catch (err) {
    if (createdLogin && newUserId) {
      const { data: stillMember } = await admin
        .from("company_members")
        .select("id")
        .eq("user_id", newUserId)
        .limit(1);
      if (!stillMember?.length) await admin.auth.admin.deleteUser(newUserId);
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create the login." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, email, fullName });
}

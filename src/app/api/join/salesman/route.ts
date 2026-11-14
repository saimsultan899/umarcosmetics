import {
  attachSalesmanAccess,
  cleanList,
  confirmExistingLogin,
  openConfirmedLogin,
} from "@/lib/auth/provision-salesman";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    token?: string;
    password?: string;
    fullName?: string;
  } | null;
  const token = body?.token?.trim() || "";
  const password = body?.password || "";
  const fullName = body?.fullName?.trim() || "";
  if (!token || password.length < 8) {
    return NextResponse.json(
      { error: "Choose a password of at least 8 characters." },
      { status: 400 },
    );
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Login setup is not configured on the server." },
      { status: 500 },
    );
  }

  const { data: invite, error: inviteError } = await admin
    .from("salesman_invites")
    .select(
      "id, organization_id, company_id, email, full_name, routes, cities, expires_at, claimed_by",
    )
    .eq("token", token)
    .maybeSingle();
  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 400 });
  }
  if (
    !invite ||
    invite.claimed_by ||
    (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now())
  ) {
    return NextResponse.json(
      { error: "Invite is invalid or already used." },
      { status: 400 },
    );
  }

  const email = String(invite.email || "").trim().toLowerCase();
  const name = fullName || String(invite.full_name || "").trim() || email;
  let userId = "";
  let createdLogin = false;
  try {
    const opened = await openConfirmedLogin(admin, {
      email,
      password,
      fullName: name,
    });
    userId = opened.userId;
    createdLogin = opened.created;
    await attachSalesmanAccess(admin, {
      userId,
      companyId: invite.company_id,
      organizationId: invite.organization_id,
      fullName: name,
      phone: null,
      permissions: null,
      routes: cleanList(invite.routes),
      cities: cleanList(invite.cities),
      allowRoleChange: false,
    });
    if (!createdLogin) {
      await confirmExistingLogin(admin, { userId, password, fullName: name });
    }
    const { error: claimError } = await admin
      .from("salesman_invites")
      .update({ claimed_by: userId, claimed_at: new Date().toISOString() })
      .eq("id", invite.id)
      .is("claimed_by", null);
    if (claimError) throw new Error(claimError.message);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not accept the invite." },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, email });
}

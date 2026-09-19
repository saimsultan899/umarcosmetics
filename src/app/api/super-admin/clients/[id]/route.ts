import {
  isNextResponse,
  requireSuperAdminApi,
} from "@/lib/super-admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const gate = await requireSuperAdminApi();
  if (isNextResponse(gate)) return gate;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    const body = (await request.json()) as {
      fullName?: string;
      phone?: string | null;
      organizationId?: string | null;
      banned?: boolean;
    };

    const admin = createAdminClient();

    const profilePatch: Record<string, unknown> = {};
    if (body.fullName !== undefined) profilePatch.full_name = body.fullName.trim();
    if (body.phone !== undefined) profilePatch.phone = body.phone?.trim() || null;
    if (body.organizationId !== undefined) {
      profilePatch.organization_id = body.organizationId;
    }

    if (Object.keys(profilePatch).length) {
      const { error } = await admin
        .from("profiles")
        .update(profilePatch)
        .eq("id", id)
        .eq("is_super_admin", false);
      if (error) throw new Error(error.message);
    }

    if (typeof body.banned === "boolean") {
      const { error } = await admin.auth.admin.updateUserById(id, {
        ban_duration: body.banned ? "876000h" : "none",
      });
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 400 },
    );
  }
}

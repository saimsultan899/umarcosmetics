import {
  isNextResponse,
  requireSuperAdminApi,
} from "@/lib/super-admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AppRole } from "@/lib/types/database";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

const ALLOWED: AppRole[] = [
  "org_admin",
  "company_admin",
  "accountant",
  "inventory",
  "sales_desk",
  "salesman",
  "viewer",
];

export async function POST(request: Request, { params }: Params) {
  const gate = await requireSuperAdminApi();
  if (isNextResponse(gate)) return gate;

  const { id: userId } = await params;
  try {
    const body = (await request.json()) as {
      action?: "attach" | "detach";
      companyId?: string;
      role?: AppRole;
      hardDelete?: boolean;
    };

    const companyId = body.companyId;
    if (!companyId) {
      return NextResponse.json({ error: "companyId required" }, { status: 400 });
    }

    const admin = createAdminClient();

    if (body.action === "detach") {
      if (body.hardDelete) {
        const { error } = await admin
          .from("company_members")
          .delete()
          .eq("company_id", companyId)
          .eq("user_id", userId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await admin
          .from("company_members")
          .update({ is_active: false })
          .eq("company_id", companyId)
          .eq("user_id", userId);
        if (error) throw new Error(error.message);
      }
      return NextResponse.json({ ok: true });
    }

    const role = body.role || "org_admin";
    if (!ALLOWED.includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const { error } = await admin.from("company_members").upsert(
      {
        company_id: companyId,
        user_id: userId,
        role,
        is_active: true,
      },
      { onConflict: "company_id,user_id" },
    );
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Membership update failed" },
      { status: 400 },
    );
  }
}

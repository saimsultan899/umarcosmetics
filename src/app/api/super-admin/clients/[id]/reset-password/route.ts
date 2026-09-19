import {
  isNextResponse,
  requireSuperAdminApi,
} from "@/lib/super-admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const gate = await requireSuperAdminApi();
  if (isNextResponse(gate)) return gate;

  const { id } = await params;
  try {
    const body = (await request.json()) as { password?: string };
    const password = (body.password || "").trim();
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, password });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Reset failed" },
      { status: 400 },
    );
  }
}

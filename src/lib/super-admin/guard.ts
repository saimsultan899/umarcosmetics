import { createClient } from "@/lib/supabase/server";
import { getVerifiedAuthUser } from "@/lib/supabase/session";
import { NextResponse } from "next/server";

export type SuperAdminApiContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
};

/** Verify the caller is an authenticated super admin. */
export async function requireSuperAdminApi(): Promise<
  SuperAdminApiContext | NextResponse
> {
  const supabase = await createClient();
  let userId: string | null = null;
  try {
    const user = await getVerifiedAuthUser(supabase);
    userId = user?.id ?? null;
  } catch {
    userId = null;
  }

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_super_admin")
    .eq("id", userId)
    .single();

  if (!profile?.is_super_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return { supabase, userId };
}

export function isNextResponse(
  value: SuperAdminApiContext | NextResponse,
): value is NextResponse {
  return value instanceof NextResponse;
}

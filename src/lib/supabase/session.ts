import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Verified identity from the access-token JWT (local crypto when using
 * asymmetric signing keys; auto-refreshes near expiry).
 *
 * Prefer this over `getUser()` for gatekeeping — no Auth-server round trip
 * on every request when the JWT is still valid and signed with JWKS.
 */
export type VerifiedAuthUser = {
  id: string;
  email: string | null;
  role: string | null;
  aal: string | null;
  sessionId: string | null;
};

export async function getVerifiedAuthUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<VerifiedAuthUser | null> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;

  const claims = data.claims;
  return {
    id: String(claims.sub),
    email: typeof claims.email === "string" ? claims.email : null,
    role: typeof claims.role === "string" ? claims.role : null,
    aal: typeof claims.aal === "string" ? claims.aal : null,
    sessionId:
      typeof claims.session_id === "string" ? claims.session_id : null,
  };
}

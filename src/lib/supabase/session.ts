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

function fromClaims(claims: Record<string, unknown>): VerifiedAuthUser {
  return {
    id: String(claims.sub),
    email: typeof claims.email === "string" ? claims.email : null,
    role: typeof claims.role === "string" ? claims.role : null,
    aal: typeof claims.aal === "string" ? claims.aal : null,
    sessionId:
      typeof claims.session_id === "string" ? claims.session_id : null,
  };
}

/**
 * Resolve the signed-in user without forcing a logout on a slow or flaky
 * claim check. getClaims() can fail briefly (JWKS / refresh race); the
 * local session JWT is enough to keep the dashboard open.
 */
export async function getVerifiedAuthUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<VerifiedAuthUser | null> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (!error && data?.claims?.sub) {
      return fromClaims(data.claims as Record<string, unknown>);
    }
  } catch {
    /* fall through to session */
  }

  try {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session?.user?.id) return null;
    return {
      id: session.user.id,
      email: session.user.email ?? null,
      role: session.user.role ?? null,
      aal: null,
      sessionId: null,
    };
  } catch {
    return null;
  }
}

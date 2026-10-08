import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Verified identity from the access-token JWT.
 *
 * Pages read this from the cookie only. They must not call getClaims() or
 * getSession(), because both refresh the token. A second refresh in the same
 * moment returns "refresh token not found" and the client wipes the session.
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

function decodeBase64Url(value: string) {
  const pad = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = pad + "=".repeat((4 - (pad.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function decodeCookiePayload(value: string) {
  if (!value.startsWith("base64-")) return value;
  try {
    return decodeBase64Url(value.slice("base64-".length));
  } catch {
    return null;
  }
}

function authCookieValue(list: { name: string; value: string }[]) {
  const cookies = list.filter(
    (cookie) =>
      cookie.name.includes("auth-token") &&
      !cookie.name.includes("code-verifier") &&
      !cookie.name.includes("flows-code-verifier"),
  );
  const whole = cookies.find((cookie) => !/\.\d+$/.test(cookie.name));
  if (whole?.value) return whole.value;
  const chunks = cookies
    .map((cookie) => {
      const match = cookie.name.match(/\.(\d+)$/);
      return match ? { index: Number(match[1]), value: cookie.value } : null;
    })
    .filter((chunk): chunk is { index: number; value: string } => Boolean(chunk))
    .sort((a, b) => a.index - b.index);
  if (!chunks.length) return null;
  return chunks.map((chunk) => chunk.value).join("");
}

/** User id from the access-token cookie. No network call and no token refresh. */
export function readAuthCookieUser(
  list: { name: string; value: string }[],
): VerifiedAuthUser | null {
  const raw = authCookieValue(list);
  if (!raw) return null;
  const decoded = decodeCookiePayload(raw);
  if (!decoded) return null;
  try {
    const session = JSON.parse(decoded) as {
      access_token?: string;
      user?: { id?: string; email?: string | null };
    };
    const token = session.access_token;
    if (!token) return null;
    const payload = token.split(".")[1];
    if (!payload) return null;
    const claims = JSON.parse(decodeBase64Url(payload)) as Record<string, unknown>;
    if (!claims.sub) return null;
    return fromClaims(claims);
  } catch {
    return null;
  }
}

/**
 * One refresh for the request gate. Pages must not call this.
 * A raced refresh ("already used" / "not found") returns null and must not
 * be treated as a logout while the access cookie is still present.
 */
export async function refreshAuthOnce(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<VerifiedAuthUser | null> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (!error && data?.claims?.sub) {
      return fromClaims(data.claims as Record<string, unknown>);
    }
  } catch {
    /* The other request already rotated this refresh token. */
  }
  return null;
}


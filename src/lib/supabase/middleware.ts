import { createServerClient } from "@supabase/ssr";
import { getVerifiedAuthUser } from "@/lib/supabase/session";
import { NextResponse, type NextRequest } from "next/server";

function hasAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some(
      (c) =>
        c.name.includes("auth-token") ||
        c.name.startsWith("sb-") ||
        c.name.includes("supabase"),
    );
}

function loginRedirect(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

/**
 * High-performance session gate for Next.js Proxy (middleware).
 *
 * Strategy (Supabase-recommended for SSR):
 * 1. No auth cookies on protected routes → redirect instantly (0 network).
 * 2. Auth cookies present → `getClaims()` verifies JWT via WebCrypto + cached
 *    JWKS (usually local). Refresh only when the access token is near expiry.
 * 3. Never call `getUser()` here — that hits the Auth API every request (~100ms–10s).
 */
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isAuthRoute =
    path === "/login" ||
    path.startsWith("/login/") ||
    path.startsWith("/auth") ||
    path === "/";
  const isPublic =
    isAuthRoute || path.startsWith("/setup") || path.startsWith("/join");

  const cookiesPresent = hasAuthCookie(request);

  // Fast reject: unauthenticated visitors never touch Supabase.
  if (!isPublic && !cookiesPresent) {
    return loginRedirect(request);
  }

  // Public page, no session cookie — skip client create & verification entirely.
  if (isPublic && !cookiesPresent) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Local JWT verify (+ proactive refresh near expiry). Returns null if invalid.
  const user = await getVerifiedAuthUser(supabase);

  if (!user && !isPublic) {
    return loginRedirect(request);
  }

  // Signed-in users may stay on /login for company picking after sign-in.
  return supabaseResponse;
}

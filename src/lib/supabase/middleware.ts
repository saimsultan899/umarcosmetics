import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getVerifiedAuthUser } from "@/lib/supabase/session";
import {
  OFFLINE_OK_COOKIE,
  OFFLINE_SHELL_COOKIE,
} from "@/lib/offline/offline-shell";

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

function hasOfflineBypass(request: NextRequest) {
  return request.cookies.get(OFFLINE_OK_COOKIE)?.value === "1";
}

function hasOfflineShell(request: NextRequest) {
  return Boolean(request.cookies.get(OFFLINE_SHELL_COOKIE)?.value);
}

function loginRedirect(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

/**
 * Session gate for Next.js Proxy.
 *
 * Offline desktop: `umar-offline-ok` + shell snapshot cookie is enough to
 * enter the app without Supabase auth cookies / JWT refresh.
 */
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isAuthRoute =
    path === "/login" ||
    path.startsWith("/login/") ||
    path.startsWith("/auth") ||
    path === "/";
  const isPublic =
    isAuthRoute ||
    path.startsWith("/setup") ||
    path.startsWith("/join") ||
    // Version probe must work on the login screen and before a session exists
    // so an offline shop can detect a newer build the moment it reconnects.
    path === "/api/app-version" ||
    path.startsWith("/api/app-version/");

  const cookiesPresent = hasAuthCookie(request);
  const offlineOk = hasOfflineBypass(request);
  const shellPresent = hasOfflineShell(request);

  // Offline unlock: shell snapshot is the local session (no sb-* cookies required).
  if (!isPublic && offlineOk && shellPresent) {
    return NextResponse.next({ request });
  }

  // Fast reject: unauthenticated visitors never touch Supabase.
  if (!isPublic && !cookiesPresent) {
    return loginRedirect(request);
  }

  // Offline + leftover auth cookies: skip Auth API.
  if (!isPublic && cookiesPresent && offlineOk) {
    return NextResponse.next({ request });
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

  let user = null;
  try {
    user = await Promise.race([
      getVerifiedAuthUser(supabase),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
  } catch {
    user = null;
  }

  if (!user && !isPublic) {
    if (offlineOk && (cookiesPresent || shellPresent)) {
      return NextResponse.next({ request });
    }
    return loginRedirect(request);
  }

  return supabaseResponse;
}

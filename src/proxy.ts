import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16 Proxy (ex-middleware).
 * Runs before every matched page request; keep logic in lib for testability.
 */
export async function proxy(request: NextRequest) {
  // Desktop apps request this exact address. A missing page must not answer it.
  if (request.nextUrl.pathname === "/latest.yml") {
    const url = request.nextUrl.clone();
    url.pathname = "/api/desktop-update/latest";
    return NextResponse.rewrite(url);
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Document navigations only. Skip static assets and Next internals so
     * JWT work never runs for icons/chunks/fonts.
     */
    "/((?!_next/static|_next/image|_next/data|favicon.ico|icons/|manifest\\.webmanifest|api/app-version|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|css|js|map|txt|xml)$).*)",
  ],
};

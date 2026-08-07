import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16 Proxy (ex-middleware).
 * Runs before every matched page request; keep logic in lib for testability.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Document navigations only. Skip static assets and Next internals so
     * JWT work never runs for icons/chunks/fonts.
     */
    "/((?!_next/static|_next/image|_next/data|favicon.ico|icons/|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|css|js|map|txt|xml)$).*)",
  ],
};

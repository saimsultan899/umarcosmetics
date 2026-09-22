import { redirect } from "next/navigation";

/**
 * Dedicated, memorable entry point for the platform console.
 *
 * `/superadmin` is the public-facing URL for the platform owner. It is kept
 * separate from the tenant-facing login/dashboard flow and simply forwards to
 * the canonical console at `/super-admin`, where `requireSuperAdmin()` enforces
 * that only a `profiles.is_super_admin` account can proceed. Everyone else is
 * bounced to their own dashboard.
 */
export default function SuperAdminEntry() {
  redirect("/super-admin");
}

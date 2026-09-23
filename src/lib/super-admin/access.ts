import type { Company } from "@/lib/types/database";

type MembershipLike = {
  companies?:
    | (Partial<Company> & {
        id?: string;
        is_active?: boolean;
        organizations?: { status?: string } | { status?: string }[] | null;
      })
    | null;
};

/** Keep only memberships for active companies under active organizations. */
export function filterUsableMemberships<T extends MembershipLike>(rows: T[]): T[] {
  return rows.filter((m) => {
    const company = m.companies;
    if (!company || company.is_active === false) return false;
    const org = Array.isArray(company.organizations)
      ? company.organizations[0]
      : company.organizations;
    return org?.status !== "suspended";
  });
}

/**
 * Platform console accounts (`profiles.is_super_admin`) are never tenants.
 * Callers should route them to `/super-admin` and skip company pickers.
 */
export function isPlatformSuperAdmin(profile: { is_super_admin?: boolean } | null | undefined) {
  return Boolean(profile?.is_super_admin);
}

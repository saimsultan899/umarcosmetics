import type { Company, CompanyMember } from "@/lib/types/database";

type CompanyWithOrg = Company & {
  is_active?: boolean;
  organizations?: { status?: string } | { status?: string }[] | null;
};

/** Keep only memberships for active companies under active organizations. */
export function filterUsableMemberships<T extends CompanyMember>(rows: T[]): T[] {
  return rows.filter((m) => {
    const company = m.companies as CompanyWithOrg | null | undefined;
    if (!company || company.is_active === false) return false;
    const org = Array.isArray(company.organizations)
      ? company.organizations[0]
      : company.organizations;
    return org?.status !== "suspended";
  });
}

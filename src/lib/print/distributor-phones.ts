/** Extra owner numbers — only for Umar Group invoices. */
export const UMAR_GROUP_OWNER_PHONES = ["0300-6765266", "0307-7842100"];

export function isUmarGroupOrg(organizationName?: string | null): boolean {
  return (
    String(organizationName || "")
      .trim()
      .toLowerCase() === "umar group"
  );
}

/** Header phones: company settings for all; Umar Group also appends owner numbers. */
export function distributorPhoneLines(
  companyPhone?: string | null,
  organizationName?: string | null,
): string[] {
  const fromCompany = String(companyPhone || "")
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const merged = [...fromCompany];
  if (isUmarGroupOrg(organizationName)) {
    for (const n of UMAR_GROUP_OWNER_PHONES) {
      if (!merged.includes(n)) merged.push(n);
    }
  }
  return merged;
}

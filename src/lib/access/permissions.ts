import type { AppRole } from "@/lib/types/database";

export const PERMISSIONS = [
  {
    key: "create_invoices",
    label: "Create invoices",
    hint: "Sale invoices and sale returns",
  },
  {
    key: "create_purchases",
    label: "Create purchases",
    hint: "Purchase invoices and purchase returns",
  },
  {
    key: "create_vouchers",
    label: "Create vouchers",
    hint: "Cash, journal, and expense vouchers",
  },
  {
    key: "edit_products",
    label: "Edit products",
    hint: "Add and change product masters",
  },
  {
    key: "edit_customers",
    label: "Edit customers",
    hint: "Add and change customers and other parties",
  },
  {
    key: "inactivate_records",
    label: "Inactivate records",
    hint: "Mark products and customers inactive",
  },
  {
    key: "view_reports",
    label: "View reports",
    hint: "Sales, stock, profit, and ledger reports",
  },
  {
    key: "manage_users",
    label: "Manage users",
    hint: "Change roles and permissions",
  },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

const ALL_KEYS: PermissionKey[] = PERMISSIONS.map((item) => item.key);

const ROLE_TEMPLATES: Record<AppRole, readonly PermissionKey[]> = {
  super_admin: ALL_KEYS,
  org_admin: ALL_KEYS,
  company_admin: ALL_KEYS,
  accountant: [
    "create_invoices",
    "create_vouchers",
    "edit_customers",
    "view_reports",
  ],
  inventory: [
    "create_purchases",
    "edit_products",
    "inactivate_records",
    "view_reports",
  ],
  sales_desk: ["create_invoices", "view_reports"],
  salesman: ["create_invoices"],
  viewer: ["view_reports"],
};

const KEY_SET = new Set<string>(ALL_KEYS);

export function isPermissionKey(value: string): value is PermissionKey {
  return KEY_SET.has(value);
}

/** Boxes a role checks before an admin customizes them. */
export function permissionsForRole(role: string): PermissionKey[] {
  const template = ROLE_TEMPLATES[role as AppRole];
  return template ? [...template] : [];
}

export function samePermissions(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((key) => set.has(key));
}

/**
 * NULL permissions follow the role template.
 * A stored array is the exact set for that user, including an empty set.
 */
export function effectivePermissions(
  member:
    | { role?: string | null; permissions?: string[] | null }
    | null
    | undefined,
  isSuperAdmin = false,
): PermissionKey[] {
  if (isSuperAdmin) return [...ALL_KEYS];
  if (!member?.role) return [];
  if (member.permissions == null) return permissionsForRole(member.role);
  return member.permissions.filter(isPermissionKey);
}

export function hasPermission(
  permissions: readonly string[],
  key: PermissionKey,
) {
  return permissions.includes(key);
}

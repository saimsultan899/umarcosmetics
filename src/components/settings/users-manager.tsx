"use client";

import { AddCompanyUserForm } from "@/components/settings/add-company-user-form";
import { Button } from "@/components/ui/button";
import { CreateDialogButton } from "@/components/ui/create-dialog";
import { Select } from "@/components/ui/select";
import {
  PERMISSIONS,
  permissionsForRole,
  samePermissions,
  type PermissionKey,
} from "@/lib/access/permissions";
import { createClient } from "@/lib/supabase/client";
import type { AppRole } from "@/lib/types/database";
import { cn } from "@/lib/utils";
import { Check, Lock, ShieldCheck, UserCog, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";

export type MemberRow = {
  id: string;
  user_id: string;
  full_name: string | null;
  phone: string | null;
  is_super_admin: boolean;
  role: AppRole;
  is_active: boolean;
  permissions: string[] | null;
};

export const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Super Admin",
  org_admin: "Org Admin",
  company_admin: "Company Admin",
  accountant: "Accountant",
  inventory: "Inventory",
  sales_desk: "Sales Desk",
  salesman: "Salesman",
  viewer: "Viewer",
};

const ROLE_HINT: Record<AppRole, string> = {
  super_admin: "Platform-wide access (managed globally)",
  org_admin: "Full control across all companies in the org",
  company_admin: "Full control of this company",
  accountant: "Ledgers, vouchers, and financial reports",
  inventory: "Stock, purchases, and transfers",
  sales_desk: "Invoicing and counter sales",
  salesman: "Field orders and assigned shops",
  viewer: "Read-only access",
};

// Roles assignable from this company screen (super_admin is a global flag, not assigned here)
const ASSIGNABLE: AppRole[] = [
  "company_admin",
  "accountant",
  "inventory",
  "sales_desk",
  "salesman",
  "viewer",
  "org_admin",
];

function PermissionMatrix({
  member,
  disabled,
  onChange,
}: {
  member: MemberRow;
  disabled: boolean;
  onChange: (permissions: string[] | null) => void;
}) {
  const template = permissionsForRole(member.role);
  const selected = member.permissions ?? template;
  const selectedSet = new Set(selected);
  const allOn = PERMISSIONS.every((item) => selectedSet.has(item.key));
  const custom =
    member.permissions != null &&
    !samePermissions(member.permissions, template);

  function toggle(key: PermissionKey, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(key);
    else next.delete(key);
    onChange(PERMISSIONS.map((item) => item.key).filter((key) => next.has(key)));
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--brand)]"
            checked={allOn}
            disabled={disabled}
            ref={(el) => {
              if (el) el.indeterminate = !allOn && selected.length > 0;
            }}
            onChange={() =>
              onChange(allOn ? [] : PERMISSIONS.map((item) => item.key))
            }
          />
          Select all
        </label>
        {custom ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            className="text-xs font-medium text-[var(--brand-strong)] disabled:opacity-50"
          >
            Use role defaults
          </button>
        ) : (
          <span className="text-[11px] text-[var(--muted)]">
            {ROLE_LABELS[member.role]} defaults
          </span>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {PERMISSIONS.map((item) => (
          <label
            key={item.key}
            className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-white px-2.5 py-2 text-sm"
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
              checked={selectedSet.has(item.key)}
              disabled={disabled}
              onChange={(e) => toggle(item.key, e.target.checked)}
            />
            <span>
              <span className="block font-medium">{item.label}</span>
              <span className="block text-[11px] text-[var(--muted)]">
                {item.hint}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function roleBadgeClass(role: AppRole) {
  switch (role) {
    case "super_admin":
    case "org_admin":
      return "bg-[var(--brand-soft)] text-[var(--brand-strong)]";
    case "company_admin":
      return "bg-indigo-50 text-indigo-700";
    case "accountant":
      return "bg-amber-50 text-amber-700";
    case "inventory":
      return "bg-emerald-50 text-emerald-700";
    case "sales_desk":
    case "salesman":
      return "bg-sky-50 text-sky-700";
    default:
      return "bg-[var(--surface-2)] text-[var(--muted)]";
  }
}

export function UsersManager({
  members,
  currentUserId,
  canManage,
  companyId,
}: {
  members: MemberRow[];
  currentUserId: string;
  canManage: boolean;
  companyId: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateMember(
    id: string,
    patch: {
      role?: AppRole;
      is_active?: boolean;
      permissions?: string[] | null;
    },
  ) {
    setBusyId(id);
    setError(null);
    const supabase = createClient();
    const { data, error: updateError } = await supabase
      .from("company_members")
      .update(patch)
      .eq("id", id)
      .select("id");
    setBusyId(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    if (!data?.length) {
      setError("You do not have permission to change this user.");
      return;
    }
    router.refresh();
  }

  const active = members.filter((m) => m.is_active);

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {!canManage ? (
        <p className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--muted)]">
          <Lock className="h-4 w-4 shrink-0" />
          You have view-only access. Ask a company admin to change roles or
          access.
        </p>
      ) : null}

      <div className="table-shell">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div>
            <p className="font-[family-name:var(--font-display)] text-lg font-semibold">
              Team members
            </p>
            <p className="text-xs text-[var(--muted)]">
              {members.length} member{members.length === 1 ? "" : "s"} ·{" "}
              {active.length} active
            </p>
          </div>
          {canManage ? (
            <CreateDialogButton
              label="Add user"
              title="Add user"
              description="They sign in with this email and password. The role fills the boxes. Change any box for this person only."
              size="lg"
            >
              <AddCompanyUserForm companyId={companyId} />
            </CreateDialogButton>
          ) : null}
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Status</th>
                {canManage ? (
                  <th className="text-right">Manage</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {members.length ? (
                members.map((m) => {
                  const isSelf = m.user_id === currentUserId;
                  const globalRole = m.is_super_admin || m.role === "super_admin";
                  const locked = globalRole || isSelf;
                  const roleValue = ASSIGNABLE.includes(m.role)
                    ? m.role
                    : "";
                  return (
                    <Fragment key={m.id}>
                    <tr className={busyId === m.id ? "opacity-60" : ""}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {m.full_name || "Unnamed user"}
                          </span>
                          {isSelf ? (
                            <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase text-[var(--brand-strong)]">
                              You
                            </span>
                          ) : null}
                          {m.is_super_admin ? (
                            <ShieldCheck
                              className="h-3.5 w-3.5 text-[var(--brand)]"
                              aria-label="Super admin"
                            />
                          ) : null}
                        </div>
                        {m.phone ? (
                          <p className="text-xs text-[var(--muted)]">{m.phone}</p>
                        ) : null}
                      </td>
                      <td>
                        <span
                          className={cn(
                            "inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold",
                            roleBadgeClass(m.role),
                          )}
                        >
                          {ROLE_LABELS[m.role]}
                        </span>
                        <p className="mt-1 text-[11px] text-[var(--muted)]">
                          {ROLE_HINT[m.role]}
                        </p>
                      </td>
                      <td>
                        {m.is_active ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                            <Check className="h-3.5 w-3.5" /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted)]">
                            <X className="h-3.5 w-3.5" /> Disabled
                          </span>
                        )}
                      </td>
                      {canManage ? (
                        <td>
                          {locked ? (
                            <p className="text-right text-[11px] text-[var(--muted)]">
                              {globalRole
                                ? "Managed globally"
                                : "Can't edit your own access"}
                            </p>
                          ) : (
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-40">
                                <Select
                                  size="sm"
                                  value={roleValue}
                                  disabled={busyId === m.id}
                                  onChange={(e) =>
                                    e.target.value &&
                                    e.target.value !== m.role &&
                                    void updateMember(m.id, {
                                      role: e.target.value as AppRole,
                                      permissions: null,
                                    })
                                  }
                                  options={ASSIGNABLE.map((r) => ({
                                    value: r,
                                    label: ROLE_LABELS[r],
                                  }))}
                                />
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                loading={busyId === m.id}
                                onClick={() =>
                                  void updateMember(m.id, {
                                    is_active: !m.is_active,
                                  })
                                }
                                className={
                                  m.is_active
                                    ? "text-[var(--muted)]"
                                    : "border-emerald-300 text-emerald-700"
                                }
                              >
                                {m.is_active ? "Disable" : "Enable"}
                              </Button>
                            </div>
                          )}
                        </td>
                      ) : null}
                    </tr>
                    {canManage && !locked ? (
                      <tr className={busyId === m.id ? "opacity-60" : ""}>
                        <td colSpan={4} className="bg-[var(--surface)] pb-4 pt-0">
                          <PermissionMatrix
                            member={m}
                            disabled={busyId === m.id}
                            onChange={(permissions) =>
                              void updateMember(m.id, { permissions })
                            }
                          />
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={canManage ? 4 : 3}
                    className="py-8 text-center text-[var(--muted)]"
                  >
                    No members found for this company.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--muted)]">
        <UserCog className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Add a user, pick a role, then adjust the boxes for that person. Your own
          row stays locked. The organization admin can delete products and customers.
          Other roles can only mark them inactive. Posted sales, purchases, and
          vouchers stay on record and are corrected with a return or a reversal.
        </p>
      </div>
    </div>
  );
}

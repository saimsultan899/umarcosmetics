"use client";

import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { AppRole } from "@/lib/types/database";
import { cn } from "@/lib/utils";
import { Check, Lock, ShieldCheck, UserCog, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type MemberRow = {
  id: string;
  user_id: string;
  full_name: string | null;
  phone: string | null;
  is_super_admin: boolean;
  role: AppRole;
  is_active: boolean;
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
}: {
  members: MemberRow[];
  currentUserId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateMember(id: string, patch: Partial<MemberRow>) {
    setBusyId(id);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("company_members")
      .update(patch)
      .eq("id", id);
    setBusyId(null);
    if (updateError) {
      setError(updateError.message);
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
        <div className="border-b border-[var(--border)] px-4 py-3">
          <p className="font-[family-name:var(--font-display)] text-lg font-semibold">
            Team members
          </p>
          <p className="text-xs text-[var(--muted)]">
            {members.length} member{members.length === 1 ? "" : "s"} ·{" "}
            {active.length} active
          </p>
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
                    <tr key={m.id} className={busyId === m.id ? "opacity-60" : ""}>
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
                                    })
                                  }
                                  options={ASSIGNABLE.map((r) => ({
                                    value: r,
                                    label: ROLE_LABELS[r],
                                  }))}
                                />
                              </div>
                              <button
                                type="button"
                                disabled={busyId === m.id}
                                onClick={() =>
                                  void updateMember(m.id, {
                                    is_active: !m.is_active,
                                  })
                                }
                                className={cn(
                                  "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50",
                                  m.is_active
                                    ? "border-[var(--border)] text-[var(--muted)] hover:border-rose-300 hover:text-rose-600"
                                    : "border-emerald-300 text-emerald-700 hover:bg-emerald-50",
                                )}
                              >
                                {m.is_active ? "Disable" : "Enable"}
                              </button>
                            </div>
                          )}
                        </td>
                      ) : null}
                    </tr>
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
          New sign-ups join here automatically once they authenticate and are
          added to this company. This screen manages the role and access of
          existing members; super-admin status is controlled at the platform
          level.
        </p>
      </div>
    </div>
  );
}

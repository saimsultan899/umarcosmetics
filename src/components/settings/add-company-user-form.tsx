"use client";

import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  PERMISSIONS,
  permissionsForRole,
  samePermissions,
  type PermissionKey,
} from "@/lib/access/permissions";
import type { AppRole } from "@/lib/types/database";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Super Admin",
  org_admin: "Org Admin",
  company_admin: "Company Admin",
  accountant: "Accountant",
  inventory: "Inventory",
  sales_desk: "Sales Desk",
  salesman: "Salesman",
  viewer: "Viewer",
};

const CREATE_ROLES: AppRole[] = [
  "salesman",
  "sales_desk",
  "accountant",
  "inventory",
  "viewer",
  "company_admin",
  "org_admin",
];

export function AddCompanyUserForm({ companyId }: { companyId: string }) {
  const router = useRouter();
  const close = useCreateDialogClose();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("salesman");
  const [custom, setCustom] = useState<PermissionKey[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = custom ?? permissionsForRole(role);
  const selectedSet = new Set(selected);
  const allOn = PERMISSIONS.every((item) => selectedSet.has(item.key));
  const template = permissionsForRole(role);
  const customized = custom != null && !samePermissions(custom, template);

  function toggle(key: PermissionKey, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(key);
    else next.delete(key);
    setCustom(PERMISSIONS.map((item) => item.key).filter((item) => next.has(item)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/company/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          fullName,
          phone,
          email,
          password,
          role,
          permissions: custom,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not create the user.");
      router.refresh();
      close?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the user.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Name</Label>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div>
          <Label>Phone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <Label>Email</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
            required
          />
        </div>
        <div>
          <Label>Password</Label>
          <Input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            At least 8 characters. Tell this person the email and password.
          </p>
        </div>
        <div className="sm:col-span-2">
          <Label>Role</Label>
          <Select
            value={role}
            onChange={(e) => {
              setRole(e.target.value as AppRole);
              setCustom(null);
            }}
            options={CREATE_ROLES.map((item) => ({
              value: item,
              label: ROLE_LABELS[item],
            }))}
          />
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--brand)]"
              checked={allOn}
              ref={(el) => {
                if (el) el.indeterminate = !allOn && selected.length > 0;
              }}
              onChange={() =>
                setCustom(allOn ? [] : PERMISSIONS.map((item) => item.key))
              }
            />
            Select all
          </label>
          {customized ? (
            <button
              type="button"
              onClick={() => setCustom(null)}
              className="text-xs font-medium text-[var(--brand-strong)]"
            >
              Use role defaults
            </button>
          ) : (
            <span className="text-[11px] text-[var(--muted)]">
              {ROLE_LABELS[role]} defaults
            </span>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {PERMISSIONS.map((item) => (
            <label
              key={item.key}
              className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-white px-2.5 py-2 text-sm"
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
                checked={selectedSet.has(item.key)}
                onChange={(e) => toggle(item.key, e.target.checked)}
              />
              <span>
                <span className="block font-medium">{item.label}</span>
                <span className="block text-[11px] text-[var(--muted)]">{item.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" loading={loading}>
          Create user
        </Button>
      </div>
    </form>
  );
}

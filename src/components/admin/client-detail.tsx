"use client";

import { CredentialBlock } from "@/components/admin/client-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ClientListItem } from "@/lib/super-admin/clients";
import type { AppRole, Company } from "@/lib/types/database";
import { ROLE_LABELS } from "@/components/settings/users-manager";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

const ATTACH_ROLES: AppRole[] = [
  "org_admin",
  "company_admin",
  "accountant",
  "inventory",
  "sales_desk",
  "viewer",
];

export function ClientDetailPanel({
  client,
  companies,
}: {
  client: ClientListItem;
  companies: Company[];
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState(client.full_name || "");
  const [phone, setPhone] = useState(client.phone || "");
  const [companyId, setCompanyId] = useState("");
  const [role, setRole] = useState<AppRole>("org_admin");
  const [newPassword, setNewPassword] = useState("");
  const [shownPassword, setShownPassword] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/super-admin/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMessage("Profile saved");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function setBanned(banned: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/super-admin/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ banned }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMessage(banned ? "Client disabled" : "Client enabled");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setShownPassword(null);
    try {
      const res = await fetch(
        `/api/super-admin/clients/${client.id}/reset-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: newPassword }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setShownPassword(data.password);
      setNewPassword("");
      setMessage("Password updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function attachCompany(e: FormEvent) {
    e.preventDefault();
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/super-admin/clients/${client.id}/memberships`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "attach",
            companyId,
            role,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setCompanyId("");
      setMessage("Company access added");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  async function detachCompany(companyIdToRemove: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/super-admin/clients/${client.id}/memberships`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "detach",
            companyId: companyIdToRemove,
            hardDelete: true,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setMessage("Company access removed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  const linkedIds = new Set(client.companies.map((c) => c.id));
  const available = companies.filter((c) => !linkedIds.has(c.id));

  function organizationName(company: Company) {
    const rel = (
      company as Company & {
        organizations?: { name: string } | { name: string }[] | null;
      }
    ).organizations;
    const org = Array.isArray(rel) ? rel[0] : rel;
    return org?.name || "Unknown group";
  }

  const clientOrgIds = new Set(
    companies
      .filter((c) =>
        client.companies.some((linked) => linked.id === c.id && linked.is_active),
      )
      .map((c) => c.organization_id),
  );

  const sameOrgGroups = available.reduce<
    Array<{ organizationId: string; organizationName: string; companies: Company[] }>
  >((acc, company) => {
    if (!clientOrgIds.has(company.organization_id)) return acc;
    let bucket = acc.find((b) => b.organizationId === company.organization_id);
    if (!bucket) {
      bucket = {
        organizationId: company.organization_id,
        organizationName: organizationName(company),
        companies: [],
      };
      acc.push(bucket);
    }
    bucket.companies.push(company);
    return acc;
  }, []);

  async function attachMany(companyIds: string[]) {
    if (!companyIds.length) return;
    setLoading(true);
    setError(null);
    try {
      for (const id of companyIds) {
        const res = await fetch(
          `/api/super-admin/clients/${client.id}/memberships`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "attach",
              companyId: id,
              role,
            }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
      }
      setMessage(
        `Attached ${companyIds.length} compan${companyIds.length === 1 ? "y" : "ies"} — same login can Switch company without re-entering password`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/super-admin/clients"
            className="text-xs font-medium text-[var(--brand)]"
          >
            ← Clients
          </Link>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold">
            {client.full_name || "Client"}
          </h1>
          <p className="mt-1 font-mono text-sm text-[var(--muted)]">
            {client.email}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          loading={loading}
          onClick={() => void setBanned(!client.banned)}
        >
          {client.banned ? "Enable login" : "Disable login"}
        </Button>
      </div>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}

      <form onSubmit={saveProfile} className="panel space-y-3 p-5">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          Profile
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Full name</Label>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <Button type="submit" loading={loading}>
          Save profile
        </Button>
      </form>

      <form onSubmit={resetPassword} className="panel space-y-3 p-5">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          Reset password
        </h2>
        <div>
          <Label>New temporary password</Label>
          <Input
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <Button type="submit" loading={loading}>
          Set password
        </Button>
        {shownPassword ? (
          <CredentialBlock email={client.email} password={shownPassword} />
        ) : null}
      </form>

      <div className="panel space-y-4 p-5">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          Company access
        </h2>
        <div className="space-y-2">
          {client.companies.length ? (
            client.companies.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {(() => {
                      const match = companies.find((row) => row.id === c.id);
                      return match ? `${organizationName(match)} · ` : "";
                    })()}
                    {ROLE_LABELS[c.role]} · {c.is_active ? "Active" : "Disabled"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-rose-600 hover:text-rose-700"
                  loading={loading}
                  onClick={() => void detachCompany(c.id)}
                >
                  Remove
                </Button>
              </div>
            ))
          ) : (
            <p className="text-sm text-[var(--muted)]">No companies assigned.</p>
          )}
        </div>

        <form onSubmit={attachCompany} className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Label>Add company</Label>
            <Select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              required
            >
              <option value="">Select company</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {organizationName(c)}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              {available.length
                ? "Search matches the company and its group. Companies already on this login stay off this list."
                : "No other company is left to add. Create one under Companies first."}
            </p>
          </div>
          <div>
            <Label>Role</Label>
            <Select
              value={role}
              onChange={(e) => setRole(e.target.value as AppRole)}
            >
              {ATTACH_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-3 flex flex-wrap gap-2">
            <Button type="submit" loading={loading} disabled={!companyId}>
              Attach company
            </Button>
            {sameOrgGroups.map((b) => (
              <Button
                key={b.organizationId}
                type="button"
                variant="secondary"
                loading={loading}
                onClick={() => void attachMany(b.companies.map((c) => c.id))}
              >
                Attach {b.companies.length} other {b.organizationName}{" "}
                {b.companies.length === 1 ? "company" : "companies"}
              </Button>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}

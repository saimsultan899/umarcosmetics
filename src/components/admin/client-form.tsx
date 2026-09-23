"use client";

import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { Company, Organization } from "@/lib/types/database";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

export function ClientForm({
  organizations,
  companies,
}: {
  organizations: Organization[];
  companies: Company[];
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [organizationId, setOrganizationId] = useState(
    organizations[0]?.id || "",
  );
  const [companyIds, setCompanyIds] = useState<string[]>(() => {
    const firstOrg = organizations[0]?.id;
    if (!firstOrg) return [];
    return companies
      .filter((c) => c.organization_id === firstOrg)
      .map((c) => c.id);
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCreds, setCreatedCreds] = useState<{
    email: string;
    password: string;
  } | null>(null);

  const orgCompanies = useMemo(
    () => companies.filter((c) => c.organization_id === organizationId),
    [companies, organizationId],
  );

  function selectAllCompanies() {
    setCompanyIds(orgCompanies.map((c) => c.id));
  }

  function toggleCompany(id: string) {
    setCompanyIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/super-admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          fullName,
          phone: phone || null,
          organizationId: organizationId || null,
          companyIds,
          role: "org_admin",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setCreatedCreds({
        email: data.client.email,
        password: data.client.password,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  if (createdCreds) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Client created. Copy credentials now — the password is not shown again.
        </p>
        <CredentialBlock email={createdCreds.email} password={createdCreds.password} />
        <Button
          type="button"
          onClick={() => {
            closeDialog?.();
            router.refresh();
          }}
        >
          Done
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>Full name</Label>
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Email (login)</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Temporary password</Label>
          <Input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <div>
          <Label>Phone</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <Label>Organization</Label>
          <Select
            value={organizationId}
            onChange={(e) => {
              const nextOrg = e.target.value;
              setOrganizationId(nextOrg);
              // Default: one shared login for every company in the org.
              setCompanyIds(
                companies
                  .filter((c) => c.organization_id === nextOrg)
                  .map((c) => c.id),
              );
            }}
          >
            <option value="">None</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {organizationId ? (
        <div>
          <div className="flex items-center justify-between gap-2">
            <Label>Assign companies (shared login)</Label>
            {orgCompanies.length ? (
              <button
                type="button"
                className="text-xs font-semibold text-[var(--brand)]"
                onClick={selectAllCompanies}
              >
                Select all
              </button>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            One email/password for every checked company. After login they use
            Switch company — no password again.
          </p>
          <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-lg border border-[var(--border)] p-3">
            {orgCompanies.length ? (
              orgCompanies.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={companyIds.includes(c.id)}
                    onChange={() => toggleCompany(c.id)}
                  />
                  {c.name}
                  {!c.is_active ? (
                    <span className="text-[10px] uppercase text-rose-600">
                      inactive
                    </span>
                  ) : null}
                </label>
              ))
            ) : (
              <p className="text-xs text-[var(--muted)]">
                No companies in this organization yet.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={loading}>
        {loading ? "Creating..." : "Create client login"}
      </Button>
    </form>
  );
}

export function CredentialBlock({
  email,
  password,
}: {
  email: string;
  password: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(`Email: ${email}\nPassword: ${password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 text-sm">
      <p>
        <span className="text-[var(--muted)]">Email:</span>{" "}
        <span className="font-mono font-medium">{email}</span>
      </p>
      <p className="mt-1">
        <span className="text-[var(--muted)]">Password:</span>{" "}
        <span className="font-mono font-medium">{password}</span>
      </p>
      <button
        type="button"
        onClick={() => void copy()}
        className="mt-3 text-xs font-semibold text-[var(--brand)]"
      >
        {copied ? "Copied" : "Copy credentials"}
      </button>
    </div>
  );
}

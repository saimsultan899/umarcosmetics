"use client";

import { CredentialBlock } from "@/components/admin/client-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";

type CompanyDraft = {
  key: string;
  name: string;
  code: string;
  city: string;
  address: string;
  phone: string;
  warehouse: string;
};

function emptyCompany(): CompanyDraft {
  return {
    key: crypto.randomUUID(),
    name: "",
    code: "",
    city: "",
    address: "",
    phone: "",
    warehouse: "MAIN",
  };
}

export function ProvisionWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [orgName, setOrgName] = useState("");
  const [companies, setCompanies] = useState<CompanyDraft[]>([emptyCompany()]);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    organization: { id: string; name: string };
    companies: Array<{ id: string; name: string }>;
    client: { id: string; email: string; password: string; full_name: string };
  } | null>(null);
  const submittingRef = useRef(false);

  function updateCompany(key: string, patch: Partial<CompanyDraft>) {
    setCompanies((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Guard against double-clicks creating duplicate orgs/companies.
    if (submittingRef.current || loading) return;
    submittingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/super-admin/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationName: orgName,
          companies: companies.map((c) => ({
            name: c.name,
            code: c.code || undefined,
            city: c.city || undefined,
            address: c.address || undefined,
            phone: c.phone || undefined,
            warehouse: c.warehouse || "MAIN",
          })),
          client: {
            email,
            password,
            fullName,
            phone: phone || undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Provision failed");
      setResult(data);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      submittingRef.current = false;
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <div className="animate-rise space-y-6">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Client ready
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {result.organization.name} · {result.companies.length} compan
            {result.companies.length === 1 ? "y" : "ies"} · give these
            credentials to the client.
          </p>
        </div>
        <CredentialBlock
          email={result.client.email}
          password={result.client.password}
        />
        <ul className="space-y-1 text-sm text-[var(--muted)]">
          {result.companies.map((c) => (
            <li key={c.id}>• {c.name}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/super-admin/clients/${result.client.id}`}
            className="inline-flex rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold !text-white"
          >
            Open client
          </Link>
          <Link
            href="/super-admin"
            className="inline-flex rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium"
          >
            Back to overview
          </Link>
        </div>
      </div>
    );
  }

  const steps = ["Organization", "Companies", "Client login", "Review"];

  return (
    <div className="animate-rise space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          New client setup
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Create organization, one or many companies, and the owner login in one
          flow.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {steps.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => setStep(i)}
            className={
              i === step
                ? "rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium !text-white"
                : "rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-sm font-medium text-[var(--muted)]"
            }
          >
            {i + 1}. {label}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="panel space-y-5 p-5">
        {step === 0 ? (
          <div>
            <Label>Organization name</Label>
            <Input
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="e.g. Umar Group"
              required
            />
            <p className="mt-2 text-xs text-[var(--muted)]">
              One organization can hold many companies. The owner login below is
              shared — they switch companies without entering the password again.
            </p>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-4">
            {companies.map((c, index) => (
              <div
                key={c.key}
                className="rounded-xl border border-[var(--border)] p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold">Company {index + 1}</p>
                  {companies.length > 1 ? (
                    <button
                      type="button"
                      className="text-[var(--muted)] hover:text-rose-600"
                      onClick={() =>
                        setCompanies((rows) =>
                          rows.filter((r) => r.key !== c.key),
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label>Name</Label>
                    <Input
                      value={c.name}
                      onChange={(e) =>
                        updateCompany(c.key, { name: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div>
                    <Label>Code</Label>
                    <Input
                      value={c.code}
                      onChange={(e) =>
                        updateCompany(c.key, { code: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label>City</Label>
                    <Input
                      value={c.city}
                      onChange={(e) =>
                        updateCompany(c.key, { city: e.target.value })
                      }
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label>Address</Label>
                    <Input
                      value={c.address}
                      onChange={(e) =>
                        updateCompany(c.key, { address: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label>Phone</Label>
                    <Input
                      value={c.phone}
                      onChange={(e) =>
                        updateCompany(c.key, { phone: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label>Default warehouse</Label>
                    <Input
                      value={c.warehouse}
                      onChange={(e) =>
                        updateCompany(c.key, { warehouse: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCompanies((rows) => [...rows, emptyCompany()])}
            >
              <Plus className="mr-1 h-4 w-4" />
              Add another company
            </Button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Owner full name</Label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Login email</Label>
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
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-3 text-sm">
            <p>
              <span className="text-[var(--muted)]">Organization:</span>{" "}
              <strong>{orgName || "—"}</strong>
            </p>
            <p>
              <span className="text-[var(--muted)]">Companies:</span>{" "}
              {companies.map((c) => c.name || "(unnamed)").join(", ")}
            </p>
            <p>
              <span className="text-[var(--muted)]">Client:</span> {fullName} ·{" "}
              {email}
            </p>
            <p className="text-xs text-[var(--muted)]">
              Owner will be org admin on every company listed above. Same email
              + password opens any of them; use Switch company in the app header
              (no re-login).
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-between gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={step === 0 || loading}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Back
          </Button>
          {step < 3 ? (
            <Button
              type="button"
              onClick={() => setStep((s) => Math.min(3, s + 1))}
            >
              Continue
            </Button>
          ) : (
            <Button type="submit" disabled={loading || submittingRef.current}>
              {loading ? "Creating..." : "Create tenant + login"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

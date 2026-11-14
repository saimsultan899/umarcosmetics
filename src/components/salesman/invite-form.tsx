"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  PERMISSIONS,
  permissionsForRole,
  samePermissions,
  type PermissionKey,
} from "@/lib/access/permissions";
import { createClient } from "@/lib/supabase/client";
import { useSingleSubmit } from "@/lib/forms/single-submit";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type RosterSalesman = {
  id: string;
  full_name: string;
  user_id: string | null;
};

export function SalesmanInviteForm({
  companyId,
  organizationId,
  salesmen = [],
}: {
  companyId: string;
  organizationId: string;
  salesmen?: RosterSalesman[];
}) {
  const router = useRouter();
  const singleSubmit = useSingleSubmit();
  const [mode, setMode] = useState<"now" | "link">("now");
  const [salesmanId, setSalesmanId] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [routes, setRoutes] = useState("");
  const [cities, setCities] = useState("");
  const [custom, setCustom] = useState<PermissionKey[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [ready, setReady] = useState<{ email: string; password: string } | null>(
    null,
  );

  const template = permissionsForRole("salesman");
  const selected = custom ?? template;
  const selectedSet = new Set(selected);

  function splitList(value: string) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function toggle(key: PermissionKey, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(key);
    else next.delete(key);
    setCustom(PERMISSIONS.map((item) => item.key).filter((item) => next.has(item)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await singleSubmit(async () => {
      setLoading(true);
      setError(null);
      setInviteUrl(null);
      setReady(null);
      try {
        if (mode === "now") {
          const res = await fetch("/api/company/salesman-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId,
              salesmanId: salesmanId || null,
              fullName,
              phone,
              email,
              password,
              permissions: custom && !samePermissions(custom, template) ? custom : null,
              routes: splitList(routes),
              cities: splitList(cities),
            }),
          });
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          if (!res.ok) throw new Error(data?.error || "Could not create the login.");
          setReady({ email: email.trim().toLowerCase(), password });
          setPassword("");
        } else {
          const supabase = createClient();
          const { data, error: rpcError } = await supabase.rpc("create_salesman_invite", {
            p_payload: {
              organization_id: organizationId,
              company_id: companyId,
              email,
              full_name: fullName,
              routes: splitList(routes),
              cities: splitList(cities),
            },
          });
          if (rpcError) throw new Error(rpcError.message);
          const token = (data as { token: string }).token;
          setInviteUrl(`${window.location.origin}/join/${token}`);
        }
        setEmail("");
        setFullName("");
        setPhone("");
        setRoutes("");
        setCities("");
        setSalesmanId("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create the login.");
      } finally {
        setLoading(false);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode("now")}
          className={
            mode === "now"
              ? "rounded-full bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white"
              : "rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-sm text-[var(--muted)]"
          }
        >
          Create login now
        </button>
        <button
          type="button"
          onClick={() => setMode("link")}
          className={
            mode === "link"
              ? "rounded-full bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white"
              : "rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-sm text-[var(--muted)]"
          }
        >
          Invite link
        </button>
      </div>
      <p className="sm:col-span-2 text-xs text-[var(--muted)]">
        {mode === "now"
          ? "The login is ready immediately. Nothing is emailed — give the salesman this email and password."
          : "A link is created for you to copy. Mail is not sent. They choose a password on the link and can sign in at once."}
      </p>
      {salesmen.length ? (
        <div className="sm:col-span-2">
          <Label>Existing salesman</Label>
          <Select
            value={salesmanId}
            onChange={(e) => {
              const id = e.target.value;
              setSalesmanId(id);
              const row = salesmen.find((item) => item.id === id);
              if (row && !fullName) setFullName(row.full_name);
            }}
          >
            <option value="">New name</option>
            {salesmen
              .filter((item) => !item.user_id)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.full_name}
                </option>
              ))}
          </Select>
        </div>
      ) : null}
      <div>
        <Label>Full name</Label>
        <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
      </div>
      <div>
        <Label>Email</Label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="salesman@email.com"
        />
      </div>
      {mode === "now" ? (
        <>
          <div>
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label>Password</Label>
            <Input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              autoComplete="new-password"
              placeholder="At least 8 characters"
            />
          </div>
          <div className="sm:col-span-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <Label>Access</Label>
              {custom ? (
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--brand)]"
                  onClick={() => setCustom(null)}
                >
                  Use salesman defaults
                </button>
              ) : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {PERMISSIONS.map((item) => (
                <label key={item.key} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selectedSet.has(item.key)}
                    onChange={(e) => toggle(item.key, e.target.checked)}
                  />
                  <span>
                    <span className="font-medium">{item.label}</span>
                    <span className="block text-xs text-[var(--muted)]">{item.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </>
      ) : null}
      <div>
        <Label>Sectors (comma separated)</Label>
        <Input
          value={routes}
          onChange={(e) => setRoutes(e.target.value)}
          placeholder="CHOWK AZAM, MAIN BAZAR"
        />
      </div>
      <div>
        <Label>Cities (comma separated)</Label>
        <Input
          value={cities}
          onChange={(e) => setCities(e.target.value)}
          placeholder="LAYYAH"
        />
      </div>
      {error ? (
        <p className="sm:col-span-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {ready ? (
        <div className="sm:col-span-2 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
          <p className="font-semibold">Login created. Share these details — they were not emailed.</p>
          <p className="mt-2">Email: <span className="font-mono">{ready.email}</span></p>
          <p>Password: <span className="font-mono">{ready.password}</span></p>
          <p className="mt-2 text-xs">They sign in and land on the field app. Access is the salesman role plus the boxes you left on.</p>
        </div>
      ) : null}
      {inviteUrl ? (
        <div className="sm:col-span-2 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
          <p className="font-semibold">Invite link ready. Mail was not sent — copy this link.</p>
          <p className="mt-1 break-all font-mono text-xs">{inviteUrl}</p>
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" loading={loading}>
          {loading
            ? "Creating..."
            : mode === "now"
              ? "Create salesman login"
              : "Create invite link"}
        </Button>
      </div>
    </form>
  );
}

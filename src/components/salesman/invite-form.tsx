"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function SalesmanInviteForm({
  companyId,
  organizationId,
}: {
  companyId: string;
  organizationId: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [routes, setRoutes] = useState("");
  const [cities, setCities] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInviteUrl(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_salesman_invite", {
      p_payload: {
        organization_id: organizationId,
        company_id: companyId,
        email,
        full_name: fullName,
        routes: routes
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        cities: cities
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      },
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const token = (data as { token: string }).token;
    const url = `${window.location.origin}/join/${token}`;
    setInviteUrl(url);
    setEmail("");
    setFullName("");
    setRoutes("");
    setCities("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
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
      {inviteUrl ? (
        <div className="sm:col-span-2 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
          <p className="font-semibold">Invite created. Share this link:</p>
          <p className="mt-1 break-all font-mono text-xs">{inviteUrl}</p>
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={loading}>
          {loading ? "Creating..." : "Create salesman invite"}
        </Button>
      </div>
    </form>
  );
}

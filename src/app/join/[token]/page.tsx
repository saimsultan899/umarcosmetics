"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

type InviteInfo = {
  email: string;
  full_name: string | null;
  company_name: string;
  routes: string[];
  cities: string[];
};

export default function JoinSalesmanPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params.token;
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("get_salesman_invite", {
        p_token: token,
      });
      setBooting(false);
      if (rpcError || !data) {
        setError("Invite is invalid or expired.");
        return;
      }
      setInvite(data as InviteInfo);
      setFullName((data as InviteInfo).full_name || "");
    }
    void load();
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!invite) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const res = await fetch("/api/join/salesman", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        password,
        fullName: fullName || invite.full_name,
      }),
    });
    const data = (await res.json().catch(() => null)) as {
      error?: string;
      email?: string;
    } | null;
    if (!res.ok) {
      setLoading(false);
      setError(data?.error || "Could not accept the invite.");
      return;
    }

    const { error: inError } = await supabase.auth.signInWithPassword({
      email: data?.email || invite.email,
      password,
    });
    setLoading(false);
    if (inError) {
      setError(inError.message);
      return;
    }

    router.push("/field");
    router.refresh();
  }

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-[var(--muted)]">
        Loading invite...
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="panel w-full max-w-md animate-rise p-8">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
          Join as salesman
        </h1>
        {invite ? (
          <p className="mt-2 text-sm text-[var(--muted)]">
            Invite for <strong>{invite.email}</strong> at{" "}
            <strong>{invite.company_name}</strong>
          </p>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {invite ? (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <Label>Full name</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div>
              <Label>Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <Button type="submit" className="w-full" loading={loading}>
              {loading ? "Creating account..." : "Accept invite & continue"}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

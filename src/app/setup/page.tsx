"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function SetupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("Shahzad Nazir");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("Umar Group");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();

    const { data: signData, error: signError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });

    if (signError) {
      // Maybe user exists — try sign in
      const { error: inError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (inError) {
        setLoading(false);
        setError(signError.message);
        return;
      }
    } else if (!signData.session) {
      // Email confirmation may be required — try password sign-in anyway
      await supabase.auth.signInWithPassword({ email, password });
    }

    const { data, error: bootError } = await supabase.rpc("bootstrap_platform", {
      p_org_name: orgName,
      p_full_name: fullName,
    });

    setLoading(false);

    if (bootError) {
      setError(bootError.message);
      return;
    }

    setMessage(`Bootstrap complete. Companies ready. ${JSON.stringify(data)}`);
    router.push("/select-company");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="panel w-full max-w-lg animate-rise p-8">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
          First-time setup
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Creates Super Admin, organization, and demo companies:{" "}
          <strong>Umar Cosmetic</strong> & <strong>Ishaq Limited</strong>.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <Label>Full name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
          <div>
            <Label>Organization</Label>
            <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
          </div>
          <div>
            <Label>Admin email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="admin@umar.com"
            />
          </div>
          <div>
            <Label>Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>

          {error ? (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          ) : null}
          {message ? (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {message}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Bootstrapping..." : "Create Super Admin & Companies"}
          </Button>
        </form>
      </div>
    </div>
  );
}

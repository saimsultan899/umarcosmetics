"use client";

import {
  CompanyPicker,
  type CompanyMembership,
} from "@/components/auth/company-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getPreferredCompanyId,
  setPreferredCompanyId,
} from "@/lib/company-preference";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, Layers3 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";

type Step = "credentials" | "company";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [rows, setRows] = useState<CompanyMembership[]>([]);
  const [preferredId, setPreferredId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    searchParams.get("error") ? "Authentication failed. Try again." : null,
  );

  useEffect(() => {
    setPreferredId(getPreferredCompanyId());

    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      setEmail(user.email || "");
      const { data } = await supabase
        .from("company_members")
        .select("*, companies(*)")
        .eq("user_id", user.id)
        .eq("is_active", true);

      const memberships = (data as CompanyMembership[]) || [];
      if (!memberships.length) return;

      if (memberships.length === 1 && memberships[0].companies?.id) {
        await openCompany(memberships[0].companies.id, memberships);
        return;
      }

      setRows(memberships);
      setStep("company");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openCompany(
    companyId: string,
    memberships: CompanyMembership[],
  ) {
    setPicking(companyId);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_active_company", {
      p_company_id: companyId,
    });
    setPicking(null);
    if (rpcError) {
      setError(rpcError.message);
      setStep("company");
      return;
    }
    setPreferredCompanyId(companyId);
    const membership = memberships.find((r) => r.companies?.id === companyId);
    router.push(membership?.role === "salesman" ? "/field" : "/dashboard");
    router.refresh();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data: authData, error: signError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (signError || !authData.user) {
      setLoading(false);
      setError(signError?.message || "Sign in failed");
      return;
    }

    const { data, error: memError } = await supabase
      .from("company_members")
      .select("*, companies(*)")
      .eq("user_id", authData.user.id)
      .eq("is_active", true);

    setLoading(false);

    if (memError) {
      setError(memError.message);
      return;
    }

    const memberships = (data as CompanyMembership[]) || [];
    setRows(memberships);

    if (memberships.length === 0) {
      router.push("/select-company");
      router.refresh();
      return;
    }

    if (memberships.length === 1 && memberships[0].companies?.id) {
      await openCompany(memberships[0].companies.id, memberships);
      return;
    }

    setPreferredId(getPreferredCompanyId());
    setStep("company");
  }

  async function backToCredentials() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setStep("credentials");
    setRows([]);
    setError(null);
  }

  return (
    <div className="login-shell">
      <div className="login-shell__bg" aria-hidden />

      <div
        className={`login-card animate-rise ${
          step === "company" ? "login-card--wide login-card--company" : "login-card--narrow"
        }`}
      >
        <div className="login-brand">
          <div className="login-brand__mark">
            <Layers3 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="login-brand__title">Umar Distribution</h1>
            <p className="login-brand__subtitle">
              {step === "credentials"
                ? "Sign in to your workspace"
                : "Select a company to continue"}
            </p>
          </div>
        </div>

        {step === "credentials" ? (
          <form onSubmit={onSubmit} className="login-form">
            <div className="login-field">
              <label htmlFor="email">Email</label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <div className="login-field">
              <label htmlFor="password">Password</label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
              />
            </div>

            {error ? (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="login-submit" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        ) : (
          <div>
            <div className="login-account-bar">
              <p className="text-[var(--muted)]">
                Signed in as{" "}
                <span className="font-medium text-[var(--ink)]">{email}</span>
              </p>
              <button
                type="button"
                onClick={() => void backToCredentials()}
                className="inline-flex items-center gap-1 text-[var(--brand)] font-medium"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Switch account
              </button>
            </div>

            {error ? (
              <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            ) : null}

            <CompanyPicker
              rows={rows}
              picking={picking}
              preferredId={preferredId}
              onPick={(id) => void openCompany(id, rows)}
              variant="login"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

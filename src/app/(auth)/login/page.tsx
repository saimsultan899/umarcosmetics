"use client";

import {
  CompanyPicker,
  type CompanyMembership,
} from "@/components/auth/company-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

    // Already signed in? Jump straight to company pick on this page.
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

    // Multiple companies → pick on this same login screen (no sidebar)
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
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 top-10 h-72 w-72 rounded-full bg-teal-500/15 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-orange-400/10 blur-3xl" />
      </div>

      <div
        className={`panel relative z-10 w-full animate-rise p-8 ${
          step === "company" ? "max-w-3xl" : "max-w-md"
        }`}
      >
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand)] text-white shadow-lg shadow-teal-900/20">
            <Layers3 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-[var(--ink)]">
              Umar Distribution
            </h1>
            <p className="text-sm text-[var(--muted)]">
              {step === "credentials"
                ? "Sign in · then open your company"
                : "Choose company to open dashboard"}
            </p>
          </div>
        </div>

        {step === "credentials" ? (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@company.com"
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <p className="rounded-xl bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--muted)]">
              After sign-in you open a company directly. Last used company opens
              automatically when available — or you can pick another.
            </p>

            {error ? (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            ) : null}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-[var(--muted)]">
                Signed in as{" "}
                <span className="font-medium text-[var(--ink)]">{email}</span>
              </p>
              <button
                type="button"
                onClick={() => void backToCredentials()}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--brand)]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Use different account
              </button>
            </div>

            {error ? (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            ) : null}

            <CompanyPicker
              rows={rows}
              picking={picking}
              preferredId={preferredId}
              onPick={(id) => void openCompany(id, rows)}
            />
          </div>
        )}

        <p className="mt-6 text-center text-xs text-[var(--muted)]">
          First time? Open <span className="font-semibold">/setup</span> to
          bootstrap Super Admin + demo companies.
        </p>
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

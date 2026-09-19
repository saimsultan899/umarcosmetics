"use client";

import {
  CompanyPicker,
  type CompanyMembership,
} from "@/components/auth/company-picker";
import { PinSetupForm, PinUnlockForm } from "@/components/auth/pin-forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import {
  getPreferredCompanyId,
  setPreferredCompanyId,
} from "@/lib/company-preference";
import {
  cacheAuthTokens,
  getCachedAuthTokens,
  getVaultMeta,
  isAppOnline,
  saveCredentialVault,
  setOfflineSessionCookie,
  unlockCredentialVault,
  vaultExists,
} from "@/lib/offline/local-auth";
import {
  writeOfflineShellCookie,
  readOfflineShellCookie,
  type OfflineShellSnapshot,
} from "@/lib/offline/offline-shell";
import { networkErrorMessage, setupServiceWorker } from "@/lib/offline/service-worker";
import { filterUsableMemberships } from "@/lib/super-admin/access";
import { getCachedSessionData, cacheSessionData } from "@/lib/offline/cache-manager";
import { createClient } from "@/lib/supabase/client";
import { withTimeout } from "@/lib/offline/fetch-timeout";
import { ArrowLeft, Layers3 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useState } from "react";

type Step = "unlock" | "credentials" | "pin-setup" | "company";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>(() => {
    if (typeof window !== "undefined") {
      if (
        window.umarDesktop?.isDesktop ||
        localStorage.getItem("umar-browser-vault-v1")
      ) {
        return "unlock";
      }
    }
    return "credentials";
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pendingPassword, setPendingPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [rows, setRows] = useState<CompanyMembership[]>([]);
  const [preferredId, setPreferredId] = useState<string | null>(null);
  const [emailHint, setEmailHint] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      try {
        return localStorage.getItem("umar_vault_hint");
      } catch (_) {
        return null;
      }
    }
    return null;
  });
  const [error, setError] = useState<string | null>(
    searchParams.get("error") ? "Authentication failed. Try again." : null,
  );

  useEffect(() => {
    void setupServiceWorker();
    setPreferredId(getPreferredCompanyId());

    (async () => {
      const hasVault = await vaultExists();
      const meta = hasVault ? await getVaultMeta() : null;
      if (meta?.emailHint) {
        setEmailHint(meta.emailHint);
        try {
          localStorage.setItem("umar_vault_hint", meta.emailHint);
        } catch (_) {}
      }
      if (hasVault) {
        setStep("unlock");
        // Security gate: When local PIN vault exists, require PIN unlock first.
        // Never auto-login or bypass PIN until user successfully unlocks.
        return;
      }

      // If no local PIN vault exists (e.g. fresh installation or web sign-in):
      setStep("credentials");

      const online = await isAppOnline();
      if (!online) {
        // Offline: only PIN unlock or cached session — skip cloud getUser.
        const cached = await getCachedSessionData();
        if (cached?.memberships?.length) {
          const memberships = cached.memberships as CompanyMembership[];
          setEmail((cached.profile?.email as string) || emailHint || "");
          setRows(memberships);
          // Stay on unlock if vault exists; otherwise show company from cache after restore attempt
        }
        return;
      }

      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await withTimeout(supabase.auth.getUser(), 8000, "getUser");
        if (!user) return;

        setOfflineSessionCookie(false);
        setEmail(user.email || "");
        const { data } = await withTimeout(
          supabase
            .from("company_members")
            .select("*, companies(*, organizations(status))")
            .eq("user_id", user.id)
            .eq("is_active", true),
          8000,
          "memberships",
        );

        const memberships = filterUsableMemberships(
          (data as CompanyMembership[]) || [],
        );
        if (!memberships.length) return;

        if (memberships.length === 1 && memberships[0].companies?.id) {
          await openCompany(memberships[0].companies.id, memberships);
          return;
        }

        setRows(memberships);
        setStep("company");
      } catch {
        // offline / timeout — stay on unlock or credentials
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function persistSessionTokens() {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      await cacheAuthTokens({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
        user: data.session.user,
      });
    }
  }

  async function persistShell(
    userId: string,
    userEmail: string,
    fullName: string,
    companyId: string | null,
    memberships: CompanyMembership[],
    isSuperAdmin = false,
  ) {
    const picked = memberships.find((m) => m.companies?.id === companyId);
    const snapshot: OfflineShellSnapshot = {
      userId,
      email: userEmail,
      fullName: fullName || userEmail,
      activeCompanyId: companyId,
      isSuperAdmin,
      company: picked?.companies
        ? {
            id: picked.companies.id,
            name: picked.companies.name,
            organization_id: (picked.companies as { organization_id?: string })
              .organization_id || "",
            city: (picked.companies as { city?: string | null }).city ?? null,
          }
        : null,
      memberships: memberships.map((m) => ({
        company_id: m.companies?.id || (m as { company_id?: string }).company_id || "",
        role: m.role,
        companies: m.companies
          ? {
              id: m.companies.id,
              name: m.companies.name,
              organization_id: (m.companies as { organization_id?: string })
                .organization_id,
              city: (m.companies as { city?: string | null }).city ?? null,
            }
          : null,
      })),
      savedAt: new Date().toISOString(),
    };
    writeOfflineShellCookie(snapshot);
    await cacheSessionData({
      userId,
      profile: {
        id: userId,
        email: userEmail,
        full_name: fullName,
        active_company_id: companyId,
        is_super_admin: isSuperAdmin,
      },
      company: snapshot.company,
      memberships: memberships as unknown as Record<string, unknown>[],
    });
  }

  async function openCompany(
    companyId: string,
    memberships: CompanyMembership[],
  ) {
    setPicking(companyId);
    setError(null);
    const online = await isAppOnline();
    setPreferredCompanyId(companyId);

    if (online) {
      const supabase = createClient();
      try {
        const { error: rpcError } = await withTimeout(
          supabase.rpc("set_active_company", { p_company_id: companyId }),
          8000,
          "set_active_company",
        );
        setPicking(null);
        if (rpcError) {
          setError(networkErrorMessage(rpcError));
          setStep("company");
          return;
        }
      } catch {
        setPicking(null);
      }
    } else {
      setPicking(null);
      setOfflineSessionCookie(true);
    }

    const supabase = createClient();
    let userId = "offline-user";
    let userEmail = email;
    try {
      if (online) {
        const { data } = await withTimeout(supabase.auth.getUser(), 5000, "getUser");
        userId = data.user?.id || userId;
        userEmail = data.user?.email || userEmail;
      } else {
        const cached = await getCachedSessionData();
        userId = cached?.userId || userId;
        userEmail = (cached?.profile?.email as string) || userEmail;
      }
    } catch {
      /* keep fallbacks */
    }
    await persistShell(userId, userEmail, userEmail, companyId, memberships);

    const membership = memberships.find((r) => r.companies?.id === companyId);
    const dest = membership?.role === "salesman" ? "/field" : "/dashboard";
    if (!online) {
      setOfflineSessionCookie(true);
      window.location.href = dest;
      return;
    }
    router.push(dest);
    router.refresh();
  }

  async function afterSuccessfulPasswordLogin(
    userId: string,
    userEmail: string,
    pwd: string,
    memberships: CompanyMembership[],
  ) {
    await persistSessionTokens();
    setOfflineSessionCookie(false);
    setPendingPassword(pwd);
    setEmail(userEmail);
    setRows(memberships);

    const supabase = createClient();
    let isSuperAdmin = false;
    try {
      const { data: profile } = await withTimeout(
        supabase
          .from("profiles")
          .select("is_super_admin, full_name")
          .eq("id", userId)
          .single(),
        5000,
        "profile",
      );
      isSuperAdmin = Boolean(profile?.is_super_admin);
      if (profile?.full_name) {
        await persistShell(
          userId,
          userEmail,
          profile.full_name,
          null,
          memberships,
          isSuperAdmin,
        );
      }
    } catch {
      /* ignore */
    }

    const hasVault = await vaultExists();
    if (!hasVault) {
      setStep("pin-setup");
      return;
    }

    if (isSuperAdmin) {
      router.push("/super-admin");
      router.refresh();
      return;
    }

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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const online = await isAppOnline();
    if (!online) {
      setLoading(false);
      setError("You are offline. Unlock with your PIN, or reconnect to sign in.");
      const hasVault = await vaultExists();
      if (hasVault) setStep("unlock");
      return;
    }

    const supabase = createClient();
    try {
      const { data: authData, error: signError } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        15000,
        "signIn",
      );

      if (signError || !authData.user) {
        setLoading(false);
        setError(networkErrorMessage(signError) || "Sign in failed");
        return;
      }

      const { data, error: memError } = await withTimeout(
        supabase
          .from("company_members")
          .select("*, companies(*, organizations(status))")
          .eq("user_id", authData.user.id)
          .eq("is_active", true),
        10000,
        "memberships",
      );

      setLoading(false);

      if (memError) {
        setError(networkErrorMessage(memError));
        return;
      }

      await afterSuccessfulPasswordLogin(
        authData.user.id,
        authData.user.email || email,
        password,
        filterUsableMemberships((data as CompanyMembership[]) || []),
      );
    } catch (err) {
      setLoading(false);
      setError(networkErrorMessage({ message: String((err as Error)?.message || err) }));
    }
  }

  async function handlePinSetup(pin: string) {
    setLoading(true);
    setError(null);
    try {
      const preferred = getPreferredCompanyId();
      await saveCredentialVault({
        pin,
        email,
        password: pendingPassword || password,
        companyId: preferred,
        userId: null,
      });
      setLoading(false);
      setPendingPassword("");

      const supabase = createClient();
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (userData.user) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("is_super_admin")
            .eq("id", userData.user.id)
            .single();
          if (profile?.is_super_admin) {
            router.push("/super-admin");
            router.refresh();
            return;
          }
        }
      } catch {
        /* fall through */
      }

      if (rows.length === 0) {
        router.push("/select-company");
        router.refresh();
        return;
      }
      if (rows.length === 1 && rows[0].companies?.id) {
        await openCompany(rows[0].companies.id, rows);
        return;
      }
      setStep("company");
    } catch (err) {
      setLoading(false);
      setError(String((err as Error)?.message || "Could not save PIN"));
    }
  }

  async function handlePinUnlock(pin: string) {
    setLoading(true);
    setError(null);

    try {
      let unlocked: Awaited<ReturnType<typeof unlockCredentialVault>>;
      try {
        unlocked = await unlockCredentialVault(pin);
      } catch (err) {
        setError(String((err as Error)?.message || "Could not open credential vault"));
        return;
      }

      if (!unlocked.ok || !unlocked.email || !unlocked.password) {
        setError(unlocked.error || "Incorrect PIN");
        return;
      }

      setEmail(unlocked.email);
      const online = await isAppOnline();

      // Prefer cloud re-auth when online (fresh tokens + memberships).
      if (online) {
        try {
          const supabase = createClient();
          const { data: authData, error: signError } = await withTimeout(
            supabase.auth.signInWithPassword({
              email: unlocked.email,
              password: unlocked.password,
            }),
            12000,
            "pin-signIn",
          );
          if (!signError && authData.user) {
            await persistSessionTokens();
            setOfflineSessionCookie(false);

            const { data } = await withTimeout(
              supabase
                .from("company_members")
                .select("*, companies(*, organizations(status))")
                .eq("user_id", authData.user.id)
                .eq("is_active", true),
              10000,
              "memberships",
            );
            const memberships = filterUsableMemberships(
              (data as CompanyMembership[]) || [],
            );
            setRows(memberships);

            const targetCompanyId =
              unlocked.companyId ||
              getPreferredCompanyId() ||
              (memberships.length === 1 ? memberships[0].companies?.id : null);

            if (targetCompanyId) {
              const hit = memberships.find(
                (m) => m.companies?.id === targetCompanyId,
              );
              if (hit?.companies?.id) {
                await openCompany(hit.companies.id, memberships);
                return;
              }
            }

            if (memberships.length === 1 && memberships[0].companies?.id) {
              await openCompany(memberships[0].companies.id, memberships);
              return;
            }

            if (memberships.length > 0) {
              setStep("company");
              return;
            }
          }
        } catch {
          // Fall through to offline restore
        }
      }

      // Offline / degraded path — do not block on setSession (can hang without net).
      const tokens = await getCachedAuthTokens();
      if (tokens) {
        try {
          const supabase = createClient();
          await withTimeout(
            supabase.auth.setSession({
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
            }),
            4000,
            "setSession",
          );
        } catch {
          // Cookies optional when shell cookie is present
        }
      }

      setOfflineSessionCookie(true);

      const cached = await getCachedSessionData();
      const shell = readOfflineShellCookie();

      let memberships = (cached?.memberships || []) as CompanyMembership[];
      if (!memberships.length && shell?.memberships?.length) {
        memberships = shell.memberships.map((m) => ({
          company_id: m.company_id,
          role: m.role,
          user_id: shell.userId,
          is_active: true,
          companies: m.companies as CompanyMembership["companies"],
        })) as CompanyMembership[];
      }

      // Ensure shell cookie exists before navigating (middleware requires it offline).
      const userId =
        cached?.userId || shell?.userId || unlocked.userId || "offline-user";
      const userEmail =
        unlocked.email ||
        shell?.email ||
        (cached?.profile?.email as string) ||
        email;
      const targetCompanyId =
        unlocked.companyId ||
        shell?.activeCompanyId ||
        getPreferredCompanyId() ||
        (memberships.length === 1
          ? memberships[0]?.companies?.id || memberships[0]?.company_id
          : null);

      if (!memberships.length && !targetCompanyId) {
        setError(
          "PIN is correct, but no company data is saved on this PC yet. Sign in once while online to download your ledger, then try again.",
        );
        return;
      }

      if (!memberships.length && targetCompanyId && shell) {
        // Minimal membership so openCompany/persistShell can run
        memberships = [
          {
            company_id: targetCompanyId,
            role: "org_admin",
            user_id: userId,
            is_active: true,
            companies: shell.company
              ? ({
                  id: shell.company.id,
                  name: shell.company.name,
                  organization_id: shell.company.organization_id,
                  city: shell.company.city,
                } as CompanyMembership["companies"])
              : ({
                  id: targetCompanyId,
                  name: "Company",
                  organization_id: "",
                } as CompanyMembership["companies"]),
          } as CompanyMembership,
        ];
      }

      setRows(memberships);
      await persistShell(
        userId,
        userEmail,
        shell?.fullName || userEmail,
        targetCompanyId,
        memberships,
      );
      setOfflineSessionCookie(true);

      if (targetCompanyId) {
        setPreferredCompanyId(targetCompanyId);
        const membership = memberships.find(
          (r) =>
            r.companies?.id === targetCompanyId ||
            r.company_id === targetCompanyId,
        );
        const dest =
          membership?.role === "salesman" ? "/field" : "/dashboard";
        // Hard navigation so middleware sees freshly written cookies.
        window.location.href = dest;
        return;
      }

      setStep("company");
    } catch (err) {
      setError(
        networkErrorMessage({
          message: String((err as Error)?.message || err),
        }) || "Unlock failed",
      );
    } finally {
      setLoading(false);
    }
  }

  async function backToCredentials() {
    const online = await isAppOnline();
    if (online) {
      const supabase = createClient();
      await supabase.auth.signOut();
    }
    setOfflineSessionCookie(false);
    setStep("credentials");
    setRows([]);
    setError(null);
  }

  const subtitle =
    step === "unlock"
      ? "Unlock with your local PIN"
      : step === "pin-setup"
        ? "Set a PIN for offline access"
        : step === "credentials"
          ? "Sign in to your workspace"
          : "Select a company to continue";

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
            <p className="login-brand__subtitle">{subtitle}</p>
          </div>
        </div>

        {step === "unlock" ? (
          <PinUnlockForm
            emailHint={emailHint}
            busy={loading}
            error={error}
            onUnlock={(pin) => void handlePinUnlock(pin)}
            onUsePassword={() => {
              setError(null);
              setStep("credentials");
            }}
          />
        ) : null}

        {step === "pin-setup" ? (
          <PinSetupForm
            busy={loading}
            error={error}
            onSave={(pin) => void handlePinSetup(pin)}
            onSkip={() => {
              if (rows.length === 1 && rows[0].companies?.id) {
                void openCompany(rows[0].companies.id, rows);
              } else if (rows.length > 1) {
                setStep("company");
              } else {
                router.push("/select-company");
              }
            }}
          />
        ) : null}

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
              <PasswordInput
                id="password"
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
        ) : null}

        {step === "company" ? (
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
        ) : null}
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

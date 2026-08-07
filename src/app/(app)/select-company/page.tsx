"use client";

import {
  CompanyPicker,
  type CompanyMembership,
} from "@/components/auth/company-picker";
import { createClient } from "@/lib/supabase/client";
import {
  getPreferredCompanyId,
  setPreferredCompanyId,
} from "@/lib/company-preference";
import { Layers3, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function SelectCompanyPage() {
  const router = useRouter();
  const [rows, setRows] = useState<CompanyMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [userLabel, setUserLabel] = useState<string>("");
  const [preferredId, setPreferredId] = useState<string | null>(null);

  useEffect(() => {
    setPreferredId(getPreferredCompanyId());

    async function load() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }

      setUserLabel(user.email || "Signed in");

      // Clear working company so nav/sidebar never shows until a fresh pick
      await supabase.rpc("clear_active_company");

      const { data: profile } = await supabase
        .from("profiles")
        .select("is_super_admin, full_name")
        .eq("id", user.id)
        .single();

      setIsSuperAdmin(Boolean(profile?.is_super_admin));
      if (profile?.full_name) setUserLabel(profile.full_name);

      const { data, error: qError } = await supabase
        .from("company_members")
        .select("*, companies(*)")
        .eq("user_id", user.id)
        .eq("is_active", true);

      if (qError) setError(qError.message);
      setRows((data as CompanyMembership[]) || []);
      setLoading(false);
    }
    void load();
  }, [router]);

  async function pick(companyId: string) {
    setPicking(companyId);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_active_company", {
      p_company_id: companyId,
    });
    setPicking(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setPreferredCompanyId(companyId);
    const membership = rows.find((r) => r.companies?.id === companyId);
    router.push(membership?.role === "salesman" ? "/field" : "/dashboard");
    router.refresh();
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="relative min-h-screen px-4 pb-16 pt-16 sm:px-6 sm:pb-20 sm:pt-20 lg:px-8">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 top-10 h-72 w-72 rounded-full bg-teal-500/15 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-orange-400/10 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-4xl animate-rise">
        <div className="mb-10 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3 sm:items-center">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand)] text-white shadow-lg shadow-teal-900/20">
              <Layers3 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">
                Multi-company access
              </p>
              <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold text-[var(--ink)]">
                Choose working company
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
                Pick a company to open its dashboard. Sidebar and menus appear
                after you select.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--muted)] hover:text-[var(--ink)]"
          >
            <LogOut className="h-4 w-4" />
            {userLabel}
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-[var(--muted)]">Loading companies...</p>
        ) : null}

        {error ? (
          <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {!loading ? (
          <CompanyPicker
            rows={rows}
            picking={picking}
            preferredId={preferredId}
            onPick={(id) => void pick(id)}
          />
        ) : null}

        {!loading && rows.length === 0 ? (
          <div className="panel mt-4 p-6 text-sm text-[var(--muted)]">
            No company membership found.{" "}
            {isSuperAdmin ? (
              <a className="font-semibold text-[var(--brand)]" href="/super-admin">
                Open Super Admin
              </a>
            ) : (
              <a className="font-semibold text-[var(--brand)]" href="/setup">
                Run setup
              </a>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

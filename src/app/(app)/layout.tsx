import { AppShell } from "@/components/layout/app-shell";
import { getMemberships } from "@/lib/auth";
import { Suspense } from "react";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile, memberships, supabase, user } = await getMemberships();

  let company = null;
  if (profile?.active_company_id) {
    const { data } = await supabase
      .from("companies")
      .select("*")
      .eq("id", profile.active_company_id)
      .maybeSingle();
    company = data;
  }

  // Allow select-company / super-admin without forcing company in layout
  return (
    <Suspense
      fallback={
        <div className="flex h-screen overflow-hidden">
          <div className="hidden w-[280px] bg-[var(--sidebar)] lg:block" />
          <div className="flex-1 bg-[var(--background)]" />
        </div>
      }
    >
      <AppShell
        company={company}
        userName={profile?.full_name || user.email || "User"}
        isSuperAdmin={profile?.is_super_admin}
      >
        {children}
        {/* memberships available for future role gating */}
        <span className="hidden">{memberships.length}</span>
      </AppShell>
    </Suspense>
  );
}

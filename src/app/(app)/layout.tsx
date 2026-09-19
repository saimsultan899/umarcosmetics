import { AppShell } from "@/components/layout/app-shell";
import { ShellSkeleton } from "@/components/ui/page-skeleton";
import { getMemberships } from "@/lib/auth";
import type { Company } from "@/lib/types/database";
import { Suspense } from "react";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile, memberships, supabase, user, offline } = await getMemberships();

  let company: Company | null = null;

  if (offline) {
    const mem = memberships.find((m) => m.company_id === profile?.active_company_id);
    company = (mem?.companies as Company | undefined) || null;
  } else if (profile?.active_company_id) {
    const result = await Promise.race([
      Promise.resolve(
        supabase
          .from("companies")
          .select("*")
          .eq("id", profile.active_company_id)
          .maybeSingle(),
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    company = (result?.data as Company | null) || null;
    if (!company) {
      const mem = memberships.find((m) => m.company_id === profile.active_company_id);
      company = (mem?.companies as Company | undefined) || null;
    }
  }

  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AppShell
        company={company}
        userName={profile?.full_name || user.email || "User"}
        isSuperAdmin={profile?.is_super_admin}
        profileData={(profile || { id: user.id }) as unknown as Record<string, unknown>}
        membershipsData={memberships as unknown as Record<string, unknown>[]}
      >
        {children}
      </AppShell>
    </Suspense>
  );
}

import { PartiesView } from "@/components/parties/parties-view";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { effectivePermissions } from "@/lib/access/permissions";
import { requireCompanyContext } from "@/lib/auth";
import { LIST_STATS_COOKIE } from "@/lib/list-stats-revision";
import { fetchPartyList, type PartyListResult } from "@/lib/queries/parties";
import { cookies } from "next/headers";
import { Suspense } from "react";

export default async function PartiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const statsRevision = (await cookies()).get(LIST_STATS_COOKIE)?.value || "";
  const { supabase, company, offline, membership, profile } =
    await requireCompanyContext();
  const permissions = effectivePermissions(
    membership,
    Boolean(profile?.is_super_admin),
  );

  let initialData: PartyListResult | null = null;
  if (!offline) {
    try {
      initialData = await fetchPartyList(supabase, company.id, sp, {
        statsRevision,
      });
    } catch {
      initialData = null;
    }
  }

  return (
    <Suspense fallback={<PageSkeleton />}>
      <PartiesView
        company={company}
        initialData={initialData}
        initialOffline={offline}
        canEdit={permissions.includes("edit_customers")}
        canInactivate={permissions.includes("inactivate_records")}
        canDelete={
          membership?.role === "org_admin" ||
          Boolean(profile?.is_super_admin)
        }
      />
    </Suspense>
  );
}

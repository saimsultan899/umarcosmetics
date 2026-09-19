import { RecoveriesView } from "@/components/recoveries/recoveries-view";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { requireCompanyContext } from "@/lib/auth";
import { fetchRecoveryList, type RecoveryListResult } from "@/lib/queries/recoveries";
import { Suspense } from "react";

export default async function SalesmanRecoveriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, company, offline } = await requireCompanyContext();

  let initialData: RecoveryListResult | null = null;
  if (!offline) {
    try {
      initialData = await fetchRecoveryList(supabase, company.id, sp);
    } catch {
      initialData = null;
    }
  }

  return (
    <Suspense fallback={<PageSkeleton />}>
      <RecoveriesView
        company={company}
        initialData={initialData}
        initialOffline={offline}
      />
    </Suspense>
  );
}

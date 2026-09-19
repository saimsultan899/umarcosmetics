import { PartiesView } from "@/components/parties/parties-view";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { requireCompanyContext } from "@/lib/auth";
import { fetchPartyList, type PartyListResult } from "@/lib/queries/parties";
import { Suspense } from "react";

export default async function PartiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, company, offline } = await requireCompanyContext();

  let initialData: PartyListResult | null = null;
  if (!offline) {
    try {
      initialData = await fetchPartyList(supabase, company.id, sp);
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
      />
    </Suspense>
  );
}

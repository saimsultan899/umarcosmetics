import { VouchersView } from "@/components/vouchers/vouchers-view";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { requireCompanyContext } from "@/lib/auth";
import { fetchVoucherList, type VoucherListResult } from "@/lib/queries/vouchers";
import type { Party } from "@/lib/types/database";
import { Suspense } from "react";

export default async function JournalVoucherPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, company, offline } = await requireCompanyContext();

  let initialData: VoucherListResult | null = null;
  let initialParties: Party[] = [];

  if (!offline) {
    try {
      const [{ data: parties }, list] = await Promise.all([
        supabase.from("parties").select("*").eq("company_id", company.id).eq("is_active", true).order("name_en"),
        fetchVoucherList(supabase, company.id, sp, "JV"),
      ]);
      initialParties = (parties as Party[]) || [];
      initialData = list;
    } catch {
      initialData = null;
    }
  }

  return (
    <Suspense fallback={<PageSkeleton />}>
      <VouchersView
        company={company}
        kind="JV"
        initialData={initialData}
        initialParties={initialParties}
        initialOffline={offline}
      />
    </Suspense>
  );
}

import { VouchersView } from "@/components/vouchers/vouchers-view";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { requireCompanyContext } from "@/lib/auth";
import { fetchVoucherList, type VoucherListResult } from "@/lib/queries/vouchers";
import { Suspense } from "react";

export default async function CashReceiptPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, company, offline } = await requireCompanyContext();

  let initialData: VoucherListResult | null = null;

  if (!offline) {
    try {
      initialData = await fetchVoucherList(supabase, company.id, sp, "CR");
    } catch {
      initialData = null;
    }
  }

  return (
    <Suspense fallback={<PageSkeleton />}>
      <VouchersView
        company={company}
        kind="CR"
        initialData={initialData}
        initialOffline={offline}
      />
    </Suspense>
  );
}

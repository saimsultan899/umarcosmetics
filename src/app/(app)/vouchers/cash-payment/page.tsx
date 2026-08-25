import { VouchersTable } from "@/components/tables/vouchers-table";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { CashVoucherForm } from "@/components/vouchers/voucher-lines-form";
import { requireCompanyContext } from "@/lib/auth";
import { fetchVoucherList } from "@/lib/queries/vouchers";
import type { Party } from "@/lib/types/database";
import { Suspense } from "react";

export default async function CashPaymentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();

  const [{ data: parties }, list] = await Promise.all([
    supabase
      .from("parties")
      .select("*")
      .eq("company_id", company.id)
      .eq("is_active", true)
      .order("name_en"),
    fetchVoucherList(supabase, company.id, sp, "CP"),
  ]);

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Cash Payment"
        description="Record money paid to suppliers / parties"
        actions={
          <CreateDialogButton
            label="New payment"
            title="New cash payment"
            description="Post money paid against parties"
            size="xl"
          >
            <CashVoucherForm
              kind="CP"
              companyId={company.id}
              organizationId={company.organization_id}
              parties={(parties || []) as Party[]}
            />
          </CreateDialogButton>
        }
      />

      <Suspense fallback={<PageSkeleton />}>
        <VouchersTable
          vouchers={list.vouchers}
          pagination={list.pagination}
          emptyLabel="No cash payments yet."
          detailBasePath="/vouchers/cash-payment"
        />
      </Suspense>
    </div>
  );
}

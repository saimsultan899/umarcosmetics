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

export default async function CashReceiptPage({
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
    fetchVoucherList(supabase, company.id, sp, "CR"),
  ]);

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Cash Receipt"
        description="Record money received from customers (reduces receivable). Vendor expiry claim credits are also cleared here if the company pays cash."
        actions={
          <CreateDialogButton
            label="New receipt"
            title="New cash receipt"
            description="Post money received against customers"
            size="xl"
          >
            <CashVoucherForm
              kind="CR"
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
          emptyLabel="No cash receipts yet."
          detailBasePath="/vouchers/cash-receipt"
        />
      </Suspense>
    </div>
  );
}

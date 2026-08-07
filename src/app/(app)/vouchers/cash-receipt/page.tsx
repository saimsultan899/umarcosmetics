import { VouchersTable } from "@/components/tables/vouchers-table";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { CashVoucherForm } from "@/components/vouchers/voucher-lines-form";
import { requireCompanyContext } from "@/lib/auth";
import type { Party } from "@/lib/types/database";

export default async function CashReceiptPage() {
  const { supabase, company } = await requireCompanyContext();

  const [{ data: parties }, { data: vouchers }] = await Promise.all([
    supabase
      .from("parties")
      .select("*")
      .eq("company_id", company.id)
      .eq("is_active", true)
      .order("name_en"),
    supabase
      .from("vouchers")
      .select("*")
      .eq("company_id", company.id)
      .eq("voucher_type", "CR")
      .order("voucher_date", { ascending: false })
      .limit(50),
  ]);

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Cash Receipt"
        description="Record money received from shops / parties (reduces receivable)"
        actions={
          <CreateDialogButton
            label="New receipt"
            title="New cash receipt"
            description="Post money received against parties"
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

      <VouchersTable
        vouchers={vouchers || []}
        emptyLabel="No cash receipts yet."
        detailBasePath="/vouchers/cash-receipt"
      />
    </div>
  );
}

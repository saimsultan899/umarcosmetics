import { VouchersTable } from "@/components/tables/vouchers-table";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { CashVoucherForm } from "@/components/vouchers/voucher-lines-form";
import { requireCompanyContext } from "@/lib/auth";
import type { Party } from "@/lib/types/database";

export default async function CashPaymentPage() {
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
      .eq("voucher_type", "CP")
      .order("voucher_date", { ascending: false })
      .limit(50),
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

      <VouchersTable
        vouchers={vouchers || []}
        emptyLabel="No cash payments yet."
        detailBasePath="/vouchers/cash-payment"
      />
    </div>
  );
}

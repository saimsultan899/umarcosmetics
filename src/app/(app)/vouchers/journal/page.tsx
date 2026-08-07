import { VouchersTable } from "@/components/tables/vouchers-table";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { JournalVoucherForm } from "@/components/vouchers/journal-form";
import { requireCompanyContext } from "@/lib/auth";
import type { Party } from "@/lib/types/database";

export default async function JournalVoucherPage() {
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
      .eq("voucher_type", "JV")
      .order("voucher_date", { ascending: false })
      .limit(50),
  ]);

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Journal Voucher"
        description="Transfer amounts between debit and credit accounts"
        actions={
          <CreateDialogButton
            label="New journal"
            title="New journal voucher"
            description="Post balanced debit / credit lines"
            size="xl"
          >
              <JournalVoucherForm
                companyId={company.id}
                organizationId={company.organization_id}
                parties={(parties || []) as Party[]}
              />
          </CreateDialogButton>
        }
      />

      <VouchersTable
        vouchers={vouchers || []}
        emptyLabel="No journal vouchers yet."
        detailBasePath="/vouchers/journal"
      />
    </div>
  );
}

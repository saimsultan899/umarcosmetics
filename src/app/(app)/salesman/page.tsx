import { SalesmanForm } from "@/components/salesman/salesman-form";
import { SalesmanInviteForm } from "@/components/salesman/invite-form";
import {
  SalesmenTable,
  type SalesmanListRow,
} from "@/components/tables/salesmen-table";
import { SalesmanInvitesTable } from "@/components/tables/salesman-invites-table";
import { Button } from "@/components/ui/button";
import {
  CreateDialogButton,
  PageHeading,
} from "@/components/ui/create-dialog";
import { requireCompanyContext } from "@/lib/auth";
import Link from "next/link";

export default async function SalesmanAdminPage() {
  const { supabase, company } = await requireCompanyContext();

  const [{ data: roster }, { data: invites }, salesAgg, recoveryAgg] =
    await Promise.all([
      supabase
        .from("salesmen")
        .select("id, full_name, phone, code, is_active, user_id, created_at")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("full_name"),
      supabase
        .from("salesman_invites")
        .select("id, email, full_name, token, claimed_by, created_at")
        .eq("company_id", company.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("sale_invoices")
        .select("salesman_id, grand_total")
        .eq("company_id", company.id)
        .eq("status", "posted")
        .not("salesman_id", "is", null),
      supabase
        .from("recoveries")
        .select("salesman_id, amount")
        .eq("company_id", company.id)
        .not("salesman_id", "is", null),
    ]);

  const salesById = new Map<string, { bills: number; sales: number }>();
  for (const row of salesAgg.data || []) {
    const id = row.salesman_id as string;
    if (!id) continue;
    const cur = salesById.get(id) || { bills: 0, sales: 0 };
    cur.bills += 1;
    cur.sales += Number(row.grand_total || 0);
    salesById.set(id, cur);
  }

  const recoveryById = new Map<
    string,
    { recoveries: number; recovered: number }
  >();
  for (const row of recoveryAgg.data || []) {
    const id = row.salesman_id as string;
    if (!id) continue;
    const cur = recoveryById.get(id) || { recoveries: 0, recovered: 0 };
    cur.recoveries += 1;
    cur.recovered += Number(row.amount || 0);
    recoveryById.set(id, cur);
  }

  const rows: SalesmanListRow[] = (roster || []).map((m) => {
    const s = salesById.get(m.id) || { bills: 0, sales: 0 };
    const r = recoveryById.get(m.id) || { recoveries: 0, recovered: 0 };
    return {
      id: m.id,
      full_name: m.full_name,
      phone: m.phone,
      code: m.code,
      is_active: m.is_active,
      user_id: m.user_id,
      created_at: m.created_at,
      bills: s.bills,
      sales: s.sales,
      recoveries: r.recoveries,
      recovered: r.recovered,
    };
  });

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Salesmen"
        description="Add field staff names to tag sale invoices and recoveries — no login needed"
        actions={
          <>
            <Link href="/sales/salesmen">
              <Button variant="secondary" size="sm">
                Salesman report
              </Button>
            </Link>
            <CreateDialogButton
              label="Invite login (optional)"
              title="Invite salesman login"
              description="Only if this person should use the field app"
              size="md"
            >
              <SalesmanInviteForm
                companyId={company.id}
                organizationId={company.organization_id}
              />
            </CreateDialogButton>
            <CreateDialogButton
              label="Add salesman"
              title="Add salesman"
              description="Name only — used on sale invoices and recoveries"
              size="md"
            >
              <SalesmanForm
                companyId={company.id}
                organizationId={company.organization_id}
              />
            </CreateDialogButton>
          </>
        }
      />

      <SalesmenTable
        rows={rows}
        companyId={company.id}
        organizationId={company.organization_id}
      />

      <SalesmanInvitesTable
        rows={(invites || []).map((i) => ({
          id: i.id,
          email: i.email,
          full_name: i.full_name,
          token: i.token,
          claimed_by: i.claimed_by,
          created_at: i.created_at,
        }))}
      />
    </div>
  );
}

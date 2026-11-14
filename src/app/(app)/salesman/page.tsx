import { SalesmenView } from "@/components/salesman/salesmen-view";
import type { SalesmanListRow } from "@/components/tables/salesmen-table";
import type { SalesmanInviteRow } from "@/hooks/use-salesmen-list";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { requireCompanyContext } from "@/lib/auth";
import { Suspense } from "react";

export default async function SalesmanAdminPage() {
  const ctx = await requireCompanyContext();
  const { supabase, company, offline } = ctx;

  let initialRows: SalesmanListRow[] = [];
  let initialInvites: SalesmanInviteRow[] = [];

  if (!offline) {
    try {
      const [{ data: roster }, { data: invites }] = await Promise.all([
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
      ]);

      initialRows = (roster || []).map((m) => ({
        id: m.id,
        full_name: m.full_name,
        phone: m.phone,
        code: m.code,
        is_active: m.is_active,
        user_id: m.user_id,
        created_at: m.created_at,
        bills: 0,
        sales: 0,
        recoveries: 0,
        recovered: 0,
      }));

      initialInvites = (invites || []).map((i) => ({
        id: i.id,
        email: i.email,
        full_name: i.full_name,
        token: i.token,
        claimed_by: i.claimed_by,
        created_at: i.created_at,
      }));
    } catch (err) {
      console.error("Failed to load initial salesmen data:", err);
    }
  }

  return (
    <Suspense fallback={<PageSkeleton />}>
      <SalesmenView
        company={company}
        initialRows={initialRows}
        initialInvites={initialInvites}
        initialOffline={offline}
      />
    </Suspense>
  );
}

import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import {
  ROLE_LABELS,
  UsersManager,
  type MemberRow,
} from "@/components/settings/users-manager";
import { PageHeading } from "@/components/ui/create-dialog";
import { requireCompanyContext } from "@/lib/auth";
import { one } from "@/lib/reports/helpers";
import type { AppRole } from "@/lib/types/database";
import { ShieldCheck, UserCheck, Users, Wallet } from "lucide-react";

const MANAGER_ROLES: AppRole[] = ["company_admin", "org_admin", "super_admin"];

export default async function UsersPage() {
  const { supabase, user, company, membership, profile } =
    await requireCompanyContext();

  const { data } = await supabase
    .from("company_members")
    .select(
      "id, user_id, role, is_active, created_at, profiles(full_name, phone, is_super_admin)",
    )
    .eq("company_id", company.id)
    .order("created_at", { ascending: true });

  const members: MemberRow[] = (data || []).map((m) => {
    const p = one(m.profiles) as {
      full_name: string | null;
      phone: string | null;
      is_super_admin: boolean;
    } | null;
    return {
      id: m.id,
      user_id: m.user_id,
      full_name: p?.full_name ?? null,
      phone: p?.phone ?? null,
      is_super_admin: Boolean(p?.is_super_admin),
      role: m.role as AppRole,
      is_active: m.is_active,
    };
  });

  const canManage =
    Boolean(profile?.is_super_admin) ||
    (membership ? MANAGER_ROLES.includes(membership.role) : false);

  const activeCount = members.filter((m) => m.is_active).length;
  const adminCount = members.filter((m) =>
    ["company_admin", "org_admin", "super_admin"].includes(m.role),
  ).length;
  const fieldCount = members.filter((m) =>
    ["salesman", "sales_desk"].includes(m.role),
  ).length;

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Users & Roles"
        description={`Team access for ${company.name}. Your role: ${
          membership ? ROLE_LABELS[membership.role] : "—"
        }.`}
      />

      <StatsGrid>
        <StatCard
          label="Members"
          value={members.length}
          format="number"
          icon={Users}
          tone="brand"
          hint="Users with access to this company"
        />
        <StatCard
          label="Active"
          value={activeCount}
          format="number"
          icon={UserCheck}
          tone="ok"
          hint="Currently able to sign in"
        />
        <StatCard
          label="Admins"
          value={adminCount}
          format="number"
          icon={ShieldCheck}
          tone="neutral"
          hint="Company / org administrators"
        />
        <StatCard
          label="Sales team"
          value={fieldCount}
          format="number"
          icon={Wallet}
          tone="neutral"
          href="/sales/salesmen"
          hint="Salesmen & sales desk"
        />
      </StatsGrid>

      <UsersManager
        members={members}
        currentUserId={user.id}
        canManage={canManage}
      />
    </div>
  );
}

import { effectivePermissions, hasPermission } from "@/lib/access/permissions";
import { requireCompanyContext } from "@/lib/auth";
import { Lock } from "lucide-react";

export default async function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { membership, profile } = await requireCompanyContext();
  const permissions = effectivePermissions(
    membership,
    Boolean(profile?.is_super_admin),
  );

  if (!hasPermission(permissions, "view_reports")) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <Lock className="mx-auto h-8 w-8 text-[var(--muted)]" />
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-xl font-semibold">
          Reports are not available for this login
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Ask a company admin to turn on View reports for your user.
        </p>
      </div>
    );
  }

  return children;
}

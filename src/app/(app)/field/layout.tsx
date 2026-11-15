import { FieldMobileNav } from "@/components/field/mobile-nav";
import { effectivePermissions } from "@/lib/access/permissions";
import { requireCompanyContext } from "@/lib/auth";

export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  const { membership } = await requireCompanyContext();
  const salesman = membership?.role === "salesman";
  const permissions = effectivePermissions(membership);

  return (
    <div className="w-full pb-24 md:pb-0">
      {children}
      <FieldMobileNav permissions={permissions} locked={salesman} />
    </div>
  );
}

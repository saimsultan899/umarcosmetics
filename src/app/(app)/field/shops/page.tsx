import { FieldHeader } from "@/components/field/field-frame";
import { FieldShopBoard, type FieldShop } from "@/components/field/field-shop-board";
import { effectivePermissions } from "@/lib/access/permissions";
import { requireCompanyContext } from "@/lib/auth";

export default async function FieldShopsPage() {
  const { supabase, company, membership, offline } = await requireCompanyContext();
  const permissions = effectivePermissions(membership);
  if (offline) {
    const { OfflineFieldShopsPage } = await import(
      "@/components/offline/offline-field-pages"
    );
    return (
      <OfflineFieldShopsPage
        companyId={company.id}
        companyName={company.name}
      />
    );
  }
  const { data: shops } = await supabase.rpc("get_salesman_shops", {
    p_company_id: company.id,
    p_as_of: new Date().toISOString().slice(0, 10),
  });

  return (
    <div className="animate-rise space-y-5">
      <FieldHeader
        title="My shops"
        description={`Sector coverage for ${company.name}`}
      />
      <FieldShopBoard
        shops={(shops || []) as FieldShop[]}
        canSell={permissions.includes("create_invoices")}
        canCollect={permissions.includes("create_vouchers")}
        canEdit={permissions.includes("edit_customers")}
      />
    </div>
  );
}

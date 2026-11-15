import { FieldHeader, FieldLinkButton } from "@/components/field/field-frame";
import { FieldShopBoard, type FieldShop } from "@/components/field/field-shop-board";
import { effectivePermissions } from "@/lib/access/permissions";
import { requireCompanyContext } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function FieldCustomersPage() {
  const { supabase, company, membership, offline } = await requireCompanyContext();
  const permissions = effectivePermissions(membership);
  if (membership?.role === "salesman" && !permissions.includes("edit_customers")) {
    redirect("/field");
  }
  if (offline) {
    return (
      <p className="rounded-[var(--radius)] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Customers need a connection.
      </p>
    );
  }
  const { data } = await supabase.rpc("get_salesman_shops", {
    p_company_id: company.id,
    p_as_of: new Date().toISOString().slice(0, 10),
  });

  return (
    <div className="animate-rise space-y-5">
      <FieldHeader
        title="Customers"
        description="Shops in your sectors. Edit opens the customer register."
        actions={<FieldLinkButton href="/parties?type=customer" tone="solid">Add or edit</FieldLinkButton>}
      />
      <FieldShopBoard
        shops={(data || []) as FieldShop[]}
        canSell={permissions.includes("create_invoices")}
        canCollect={permissions.includes("create_vouchers")}
        canEdit={false}
      />
    </div>
  );
}

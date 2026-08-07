import { FieldSaleForm } from "@/components/field/field-sale-form";
import { requireCompanyContext } from "@/lib/auth";
import type { Product, Warehouse } from "@/lib/types/database";

export default async function FieldSalePage() {
  const { supabase, company } = await requireCompanyContext();

  const [{ data: shops }, { data: products }, { data: warehouses }] =
    await Promise.all([
      supabase.rpc("get_salesman_shops", {
        p_company_id: company.id,
        p_as_of: new Date().toISOString().slice(0, 10),
      }),
      supabase
        .from("products")
        .select("*")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("code"),
      supabase
        .from("warehouses")
        .select("*")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("name"),
    ]);

  return (
    <div className="animate-rise mx-auto w-full max-w-3xl space-y-5">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold sm:text-3xl">
          Quick sale
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Credit sale from market — queues offline if needed
        </p>
      </div>
      <div className="panel p-4 sm:p-6">
        <FieldSaleForm
          companyId={company.id}
          organizationId={company.organization_id}
          shops={(shops || []) as Array<{
            party_id: string;
            party_code: string;
            name_en: string;
            route: string | null;
            city: string | null;
          }>}
          products={(products || []) as Product[]}
          warehouses={(warehouses || []) as Warehouse[]}
        />
      </div>
    </div>
  );
}

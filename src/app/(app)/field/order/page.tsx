import { FieldOrderApp, type FieldOrderRow, type OrderProduct, type OrderShop, type OrderWarehouse } from "@/components/field/field-order-app";
import { requireCompanyContext } from "@/lib/auth";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";

type LineEmbed = {
  qty: number | string;
  amount: number | string;
  status: string;
  warehouse_id: string;
  warehouses: { name: string } | { name: string }[] | null;
};

type OrderEmbed = {
  id: string;
  order_no: string;
  order_date: string;
  status: string;
  note: string | null;
  parties: { party_code: string; name_en: string } | { party_code: string; name_en: string }[] | null;
  sale_order_lines: LineEmbed[] | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

export default async function FieldOrderPage() {
  const ctx = await requireCompanyContext();
  const { supabase, company, user, offline } = ctx;
  if (offline) {
    return (
      <div className="animate-rise mx-auto w-full max-w-3xl space-y-4">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
          Take order
        </h1>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Take order needs a connection. Collect and Quick sale still work offline.
        </div>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const [{ data: shops }, products, { data: warehouses }, { data: orderRows }] =
    await Promise.all([
      supabase.rpc("get_salesman_shops", {
        p_company_id: company.id,
        p_as_of: today,
      }),
      fetchAllPages<OrderProduct>((from, to) =>
        supabase
          .from("products")
          .select("id, code, name_en, sale_rate, retail_rate, default_warehouse_id")
          .eq("company_id", company.id)
          .eq("is_active", true)
          .order("name_en", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      ).catch(() => [] as OrderProduct[]),
      supabase
        .from("warehouses")
        .select("id, name")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("sale_orders")
        .select(
          "id, order_no, order_date, status, note, parties!sale_orders_party_id_fkey(party_code, name_en), sale_order_lines(qty, amount, status, warehouse_id, warehouses(name))",
        )
        .eq("company_id", company.id)
        .eq("created_by", user.id)
        .order("created_at", { ascending: false })
        .limit(40),
    ]);

  const orders: FieldOrderRow[] = ((orderRows || []) as unknown as OrderEmbed[]).map((row) => {
    const party = one(row.parties);
    const lines = row.sale_order_lines || [];
    const names = new Set<string>();
    for (const line of lines) {
      const warehouse = one(line.warehouses);
      if (warehouse?.name) names.add(warehouse.name);
    }
    return {
      id: row.id,
      order_no: row.order_no,
      order_date: row.order_date,
      status: row.status,
      note: row.note,
      partyName: party ? `${party.party_code} ${party.name_en}` : "Customer",
      qty: lines.reduce((sum, line) => sum + Number(line.qty || 0), 0),
      amount: lines.reduce((sum, line) => sum + Number(line.amount || 0), 0),
      companies: [...names],
    };
  });

  return (
    <div className="animate-rise mx-auto w-full max-w-3xl space-y-4">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold sm:text-3xl">
          Take order
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Trade price is locked. The office bills stock when it fulfils the order.
        </p>
      </div>
      <FieldOrderApp
        companyId={company.id}
        organizationId={company.organization_id}
        shops={(shops || []) as OrderShop[]}
        products={products}
        warehouses={(warehouses || []) as OrderWarehouse[]}
        orders={orders}
      />
    </div>
  );
}

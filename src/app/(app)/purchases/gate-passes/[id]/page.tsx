import { GatePassPrint } from "@/components/trading/gate-pass-print";
import { requireCompanyContext } from "@/lib/auth";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function GatePassDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const autoPrint = sp.print === "1" || sp.print === "true";
  const { supabase, company, profile } = await requireCompanyContext();

  const { data: pass } = await supabase
    .from("gate_passes")
    .select(
      "*, parties(name_en, party_code, address, city, phone), warehouses(name)",
    )
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();

  if (!pass) notFound();

  const { data: items } = await supabase
    .from("gate_pass_items")
    .select("*, products(packing, unit_type, base_unit)")
    .eq("gate_pass_id", id)
    .order("sort_order");

  const party = pass.parties as {
    name_en?: string;
    party_code?: string;
    address?: string | null;
    city?: string | null;
    phone?: string | null;
  } | null;
  const warehouse = Array.isArray(pass.warehouses)
    ? pass.warehouses[0]
    : pass.warehouses;

  return (
    <div className="animate-rise space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            Gate pass · {company.name}
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold">
            {pass.pass_no}
          </h1>
        </div>
        <Link
          href="/purchases/gate-passes"
          className="rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium"
        >
          Back
        </Link>
      </div>

      <GatePassPrint
        companyName={company.name}
        companyAddress={[company.address, company.city].filter(Boolean).join(", ")}
        companyNtn={company.ntn}
        companyPhone={company.phone}
        passNo={pass.pass_no}
        date={pass.pass_date}
        supplierCode={party?.party_code}
        supplierName={party?.name_en}
        supplierAddress={[party?.address, party?.city].filter(Boolean).join(", ")}
        warehouseName={warehouse?.name}
        brand={pass.manufacturer}
        vehicleNo={pass.vehicle_no}
        transporter={pass.transporter}
        poNo={pass.po_no}
        biltyNo={pass.bilty_no}
        remarks={pass.remarks}
        lines={(items || []).map((i) => {
          const product = Array.isArray(i.products) ? i.products[0] : i.products;
          return {
            product_code: i.product_code,
            product_name: i.product_name,
            qty: Number(i.qty),
            packing: Number(product?.packing || 1),
            unit_type: product?.unit_type || null,
            base_unit: product?.base_unit || null,
          };
        })}
        preparedBy={profile?.full_name}
        autoPrint={autoPrint}
      />
    </div>
  );
}

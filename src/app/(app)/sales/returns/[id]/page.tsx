import { PrintDocument } from "@/components/trading/print-document";
import { requireCompanyContext } from "@/lib/auth";
import { formatPkr } from "@/lib/utils";
import { notFound } from "next/navigation";

function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function SaleReturnDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const autoPrint = sp.print === "1" || sp.print === "true";
  const { supabase, company } = await requireCompanyContext();

  const { data: doc } = await supabase
    .from("sale_returns")
    .select("*, parties(name_en, party_code), warehouses(name)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();

  if (!doc) notFound();

  const { data: items } = await supabase
    .from("sale_return_items")
    .select("*")
    .eq("sale_return_id", id)
    .order("sort_order");

  const productIds = [
    ...new Set(
      (items || [])
        .map((i) => i.product_id as string | null)
        .filter((pid): pid is string => Boolean(pid)),
    ),
  ];

  const brandByProduct = new Map<string, string>();
  if (productIds.length) {
    const { data: products } = await supabase
      .from("products")
      .select("id, default_warehouse_id")
      .in("id", productIds);

    const warehouseIds = [
      ...new Set(
        (products || [])
          .map((p) => p.default_warehouse_id as string | null)
          .filter((wid): wid is string => Boolean(wid)),
      ),
    ];

    const nameByWarehouse = new Map<string, string>();
    if (warehouseIds.length) {
      const { data: warehouses } = await supabase
        .from("warehouses")
        .select("id, name")
        .in("id", warehouseIds);
      for (const w of warehouses || []) {
        nameByWarehouse.set(w.id, w.name);
      }
    }

    for (const p of products || []) {
      const name = p.default_warehouse_id
        ? nameByWarehouse.get(p.default_warehouse_id)
        : undefined;
      if (name) brandByProduct.set(p.id, name);
    }
  }

  const headerWarehouse = one(
    doc.warehouses as { name?: string } | { name?: string }[] | null,
  )?.name;

  const lines = (items || []).map((i) => {
    const brandCompany =
      (i.product_id ? brandByProduct.get(i.product_id) : null) ||
      headerWarehouse ||
      "";
    return {
      product_code: i.product_code,
      product_name: i.product_name,
      company: brandCompany || null,
      brandCompany,
      qty: Number(i.qty),
      rate: Number(i.rate),
      discount: Number(i.discount || 0),
      amount: Number(i.amount),
    };
  });

  const brandNames = [
    ...new Set(lines.map((l) => l.brandCompany).filter(Boolean)),
  ];
  const companyLabel =
    brandNames.length > 1 ? "All" : brandNames[0] || headerWarehouse || null;

  const party = one(
    doc.parties as
      | { name_en?: string; party_code?: string }
      | { name_en?: string; party_code?: string }[]
      | null,
  );

  return (
    <PrintDocument
      companyName={company.name}
      companyAddress={[company.address, company.city].filter(Boolean).join(", ")}
      title="Sale Return"
      docNo={doc.return_no}
      date={doc.return_date}
      partyName={party?.name_en}
      partyCode={party?.party_code}
      warehouseName={companyLabel}
      lines={lines.map(({ brandCompany: _brand, ...line }) => line)}
      totals={[
        { label: "Subtotal", value: formatPkr(doc.subtotal) },
        { label: "Trade discount", value: formatPkr(doc.discount_total) },
        { label: "Extra discount", value: formatPkr(Number(doc.extra_discount || 0)) },
        {
          label: "Grand total",
          value: formatPkr(doc.grand_total),
          strong: true,
        },
      ]}
      autoPrint={autoPrint}
    />
  );
}

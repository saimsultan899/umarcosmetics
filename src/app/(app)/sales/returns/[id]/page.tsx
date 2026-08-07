import { PrintDocument } from "@/components/trading/print-document";
import { requireCompanyContext } from "@/lib/auth";
import { formatPkr } from "@/lib/utils";
import { notFound } from "next/navigation";

export default async function SaleReturnDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  return (
    <PrintDocument
      companyName={company.name}
      companyAddress={[company.address, company.city].filter(Boolean).join(", ")}
      title="Sale Return"
      docNo={doc.return_no}
      date={doc.return_date}
      partyName={doc.parties?.name_en}
      partyCode={doc.parties?.party_code}
      warehouseName={doc.warehouses?.name}
      lines={(items || []).map((i) => ({
        product_code: i.product_code,
        product_name: i.product_name,
        qty: Number(i.qty),
        rate: Number(i.rate),
        amount: Number(i.amount),
      }))}
      totals={[
        { label: "Subtotal", value: formatPkr(doc.subtotal) },
        { label: "Grand total", value: formatPkr(doc.grand_total) },
      ]}
    />
  );
}

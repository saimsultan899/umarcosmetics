import { PrintDocument } from "@/components/trading/print-document";
import { requireCompanyContext } from "@/lib/auth";
import { formatPkr } from "@/lib/utils";
import { notFound } from "next/navigation";

export default async function PurchaseReturnDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, company } = await requireCompanyContext();

  const { data: doc } = await supabase
    .from("purchase_returns")
    .select("*, parties(name_en, party_code), warehouses(name)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();

  if (!doc) notFound();

  const { data: items } = await supabase
    .from("purchase_return_items")
    .select("*")
    .eq("purchase_return_id", id)
    .order("sort_order");

  return (
    <PrintDocument
      companyName={company.name}
      companyAddress={[company.address, company.city].filter(Boolean).join(", ")}
      title="Purchase Return"
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
        discount: Number(i.discount || 0),
        amount: Number(i.amount),
      }))}
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
    />
  );
}

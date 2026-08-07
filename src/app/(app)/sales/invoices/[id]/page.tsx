import { PrintDocument } from "@/components/trading/print-document";
import { requireCompanyContext } from "@/lib/auth";
import { formatPkr } from "@/lib/utils";
import { notFound } from "next/navigation";

export default async function SaleInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, company } = await requireCompanyContext();

  const { data: invoice } = await supabase
    .from("sale_invoices")
    .select("*, parties(name_en, party_code), warehouses(name)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();

  if (!invoice) notFound();

  const { data: items } = await supabase
    .from("sale_invoice_items")
    .select("*")
    .eq("sale_invoice_id", id)
    .order("sort_order");

  return (
    <div className="animate-rise">
      <PrintDocument
        companyName={company.name}
        companyAddress={[company.address, company.city].filter(Boolean).join(", ")}
        title="Sale Invoice"
        docNo={invoice.invoice_no}
        date={invoice.invoice_date}
        partyName={invoice.parties?.name_en}
        partyCode={invoice.parties?.party_code}
        warehouseName={invoice.warehouses?.name}
        extraMeta={[
          { label: "Payment", value: invoice.payment_type },
          { label: "Paid", value: formatPkr(invoice.amount_paid) },
        ]}
        lines={(items || []).map((i) => ({
          product_code: i.product_code,
          product_name: i.product_name,
          qty: Number(i.qty),
          rate: Number(i.rate),
          discount: Number(i.discount),
          amount: Number(i.amount),
        }))}
        totals={[
          { label: "Subtotal", value: formatPkr(invoice.subtotal) },
          { label: "Discount", value: formatPkr(invoice.discount_total) },
          { label: "Grand total", value: formatPkr(invoice.grand_total) },
        ]}
      />
    </div>
  );
}

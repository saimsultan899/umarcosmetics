import { PrintDocument } from "@/components/trading/print-document";
import { requireCompanyContext } from "@/lib/auth";
import { amountInWordsPkr, formatPkr } from "@/lib/utils";
import { notFound } from "next/navigation";

export default async function PurchaseInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, company } = await requireCompanyContext();

  const { data: invoice } = await supabase
    .from("purchase_invoices")
    .select("*, parties(name_en, party_code, address, city, phone), warehouses(name)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();

  if (!invoice) notFound();

  const { data: items } = await supabase
    .from("purchase_invoice_items")
    .select("*")
    .eq("purchase_invoice_id", id)
    .order("sort_order");

  const partyAddress = [invoice.parties?.address, invoice.parties?.city]
    .filter(Boolean)
    .join(", ");

  return (
    <PrintDocument
      companyName={company.name}
      companyAddress={[company.address, company.city].filter(Boolean).join(", ")}
      companyNtn={company.ntn}
      companyPhone={company.phone}
      title="Purchase Invoice"
      docNo={invoice.invoice_no}
      date={invoice.invoice_date}
      partyName={invoice.parties?.name_en}
      partyCode={invoice.parties?.party_code}
      partyAddress={partyAddress || null}
      partyPhone={invoice.parties?.phone}
      warehouseName={invoice.warehouses?.name}
      extraMeta={
        invoice.supplier_bill_no
          ? [{ label: "Vendor bill", value: invoice.supplier_bill_no }]
          : []
      }
      lines={(items || []).map((i) => ({
        product_code: i.product_code,
        product_name: i.product_name,
        qty: Number(i.qty),
        rate: Number(i.rate),
        amount: Number(i.amount),
      }))}
      totals={[
        { label: "Subtotal", value: formatPkr(invoice.subtotal) },
        { label: "Discount", value: formatPkr(invoice.discount_total) },
        { label: "Grand total", value: formatPkr(invoice.grand_total), strong: true },
      ]}
      amountInWords={amountInWordsPkr(invoice.grand_total)}
      signatures={["Prepared by", "Authorized by"]}
    />
  );
}

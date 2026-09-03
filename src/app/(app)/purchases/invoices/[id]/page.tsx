import { PrintDocument } from "@/components/trading/print-document";
import { requireCompanyContext } from "@/lib/auth";
import { amountInWordsPkr, formatPkr } from "@/lib/utils";
import { notFound } from "next/navigation";

export default async function PurchaseInvoiceDetailPage({
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

  const { data: invoice } = await supabase
    .from("purchase_invoices")
    .select("*, parties(name_en, party_code, address, city, phone), warehouses(name)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();

  if (!invoice) notFound();

  const { data: items } = await supabase
    .from("purchase_invoice_items")
    .select("*, products(packing, unit_type, base_unit)")
    .eq("purchase_invoice_id", id)
    .order("sort_order");

  const party = Array.isArray(invoice.parties) ? invoice.parties[0] : invoice.parties;
  const warehouse = Array.isArray(invoice.warehouses)
    ? invoice.warehouses[0]
    : invoice.warehouses;

  const extraDiscount = Number(invoice.extra_discount || 0);
  const distributorAddress = [company.address, company.city]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="animate-rise">
      <PrintDocument
        companyName={company.name}
        companyAddress={distributorAddress || null}
        companyNtn={company.ntn}
        companyPhone={company.phone}
        title="Purchase Invoice"
        docNo={invoice.invoice_no}
        date={invoice.invoice_date}
        printedAt={invoice.created_at}
        partyName={party?.name_en}
        partyCode={party?.party_code}
        partyAddress={party?.address || null}
        partyCity={party?.city || null}
        partyPhone={party?.phone}
        warehouseName={warehouse?.name}
        extraMeta={
          invoice.supplier_bill_no
            ? [{ label: "Vendor bill", value: invoice.supplier_bill_no }]
            : []
        }
        lines={(items || []).map((i) => {
          const product = Array.isArray(i.products) ? i.products[0] : i.products;
          const packing = Number(product?.packing || 1);
          return {
            product_code: i.product_code,
            product_name: i.product_name,
            qty: Number(i.qty),
            rate: Number(i.rate),
            discount: Number(i.discount || 0),
            amount: Number(i.amount),
            packing,
            unit_type: product?.unit_type || "Carton",
            base_unit: product?.base_unit || "Unit",
          };
        })}
        totals={[
          { label: "Subtotal", value: formatPkr(invoice.subtotal) },
          { label: "Trade discount", value: formatPkr(invoice.discount_total) },
          { label: "Extra discount", value: formatPkr(extraDiscount) },
          {
            label: "Grand total",
            value: formatPkr(invoice.grand_total),
            strong: true,
          },
        ]}
        amountInWords={amountInWordsPkr(invoice.grand_total)}
        signatures={["Prepared by", "Authorized by"]}
        autoPrint={autoPrint}
      />
    </div>
  );
}

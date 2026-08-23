import { SaleInvoicePrint } from "@/components/trading/sale-invoice-print";
import { requireCompanyContext } from "@/lib/auth";
import { notFound } from "next/navigation";

export default async function SaleInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, company, profile } = await requireCompanyContext();

  const { data: invoice } = await supabase
    .from("sale_invoices")
    .select(
      "*, parties(name_en, party_code, address, city, phone, mobile, contact_person, route, head), warehouses(name), salesman:profiles!sale_invoices_salesman_id_fkey(full_name, phone)",
    )
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();

  if (!invoice) notFound();

  const { data: items } = await supabase
    .from("sale_invoice_items")
    .select("*")
    .eq("sale_invoice_id", id)
    .order("sort_order");

  const { data: balanceRaw } = await supabase.rpc("get_party_balance", {
    p_company_id: company.id,
    p_party_id: invoice.party_id,
    p_as_of: invoice.invoice_date,
  });

  // Balance after this bill includes this invoice; previous = balance − bill
  const balanceAsOf = Number(balanceRaw || 0);
  const billAmount = Number(invoice.grand_total || 0);
  const previousBalance = balanceAsOf - billAmount;

  const party = invoice.parties as {
    name_en?: string;
    party_code?: string;
    phone?: string | null;
    mobile?: string | null;
    contact_person?: string | null;
    route?: string | null;
    head?: string | null;
    city?: string | null;
  } | null;

  const salesman = invoice.salesman as {
    full_name?: string | null;
    phone?: string | null;
  } | null;

  const salesmanLabel = [
    salesman?.full_name || profile?.full_name,
    salesman?.phone,
  ]
    .filter(Boolean)
    .join(" ");

  const sector = [party?.route || party?.head, party?.city]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="animate-rise">
      <SaleInvoicePrint
        companyName={company.name}
        companyPhone={company.phone}
        docNo={invoice.invoice_no}
        date={invoice.invoice_date}
        partyCode={party?.party_code}
        partyName={party?.name_en}
        partyOwner={party?.contact_person}
        partyPhone={party?.mobile || party?.phone}
        sector={sector || invoice.route || null}
        salesmanLabel={salesmanLabel || null}
        lines={(items || []).map((i) => ({
          product_name: i.product_name,
          qty: Number(i.qty),
          bonus: Number(i.bonus_qty || 0),
          tradePrice: Number(i.rate),
          discount: Number(i.discount || 0),
          amount: Number(i.amount),
        }))}
        subtotal={Number(invoice.subtotal || 0)}
        tradeDiscount={Number(invoice.discount_total || 0)}
        extraDiscount={0}
        billAmount={billAmount}
        previousBalance={previousBalance}
        preparedBy={salesman?.full_name || profile?.full_name}
      />
    </div>
  );
}

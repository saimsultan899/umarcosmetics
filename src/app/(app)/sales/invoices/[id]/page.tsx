import { SaleInvoicePrint } from "@/components/trading/sale-invoice-print";
import { requireCompanyContext } from "@/lib/auth";
import { notFound } from "next/navigation";

export default async function SaleInvoiceDetailPage({
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

  const { data: invoice } = await supabase
    .from("sale_invoices")
    .select(
      "*, parties(name_en, party_code, address, city, phone, mobile, contact_person, route, head), warehouses(name), salesman:salesmen!sale_invoices_salesman_id_fkey(full_name, phone)",
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

  const [{ data: balanceRaw }, { data: lastRecovery }, { data: lastCredit }] =
    await Promise.all([
      supabase.rpc("get_party_balance", {
        p_company_id: company.id,
        p_party_id: invoice.party_id,
        p_as_of: invoice.invoice_date,
      }),
      supabase
        .from("recoveries")
        .select("recovery_date, amount")
        .eq("company_id", company.id)
        .eq("party_id", invoice.party_id)
        .lte("recovery_date", invoice.invoice_date)
        .order("recovery_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("ledger_entries")
        .select("entry_date, credit")
        .eq("company_id", company.id)
        .eq("party_id", invoice.party_id)
        .gt("credit", 0)
        .lte("entry_date", invoice.invoice_date)
        .neq("ref_table", "sale_invoices")
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  let previousPayment = 0;
  if (lastRecovery?.recovery_date) {
    const { data: sameDay } = await supabase
      .from("recoveries")
      .select("amount")
      .eq("company_id", company.id)
      .eq("party_id", invoice.party_id)
      .eq("recovery_date", lastRecovery.recovery_date);
    previousPayment = (sameDay || []).reduce(
      (s, r) => s + Number(r.amount || 0),
      0,
    );
  } else if (lastCredit) {
    previousPayment = Number(lastCredit.credit || 0);
  }

  // Balance after this bill includes this invoice; previous = balance − bill
  const balanceAsOf = Number(balanceRaw || 0);
  const billAmount = Number(invoice.grand_total || 0);
  const previousBalance = balanceAsOf - billAmount;
  const paidOnThisBill = Number(invoice.amount_paid || 0);

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
          scheme: i.scheme,
          tradePrice: Number(i.rate),
          discount: Number(i.discount || 0),
          amount: Number(i.amount),
        }))}
        subtotal={Number(invoice.subtotal || 0)}
        tradeDiscount={Number(invoice.discount_total || 0)}
        extraDiscount={Number(invoice.extra_discount || 0)}
        billAmount={billAmount}
        paid={paidOnThisBill}
        previousPayment={previousPayment}
        previousBalance={previousBalance}
        preparedBy={salesman?.full_name || profile?.full_name}
        autoPrint={autoPrint}
      />
    </div>
  );
}

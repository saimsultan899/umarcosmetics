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
  const { supabase, company, profile, offline } = await requireCompanyContext();

  if (offline) {
    const { renderOfflineDocument } = await import(
      "@/lib/offline/render-offline-page"
    );
    return renderOfflineDocument(
      "sale_invoice",
      company,
      id,
      "/sales/invoices",
      autoPrint,
    );
  }

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

  const [{ data: balanceBeforeRaw }, { data: recoveryRows }] =
    await Promise.all([
      supabase.rpc("get_party_balance_before", {
        p_company_id: company.id,
        p_party_id: invoice.party_id,
        p_as_of: invoice.invoice_date,
        p_before: invoice.created_at,
      }),
      supabase
        .from("recoveries")
        .select("recovery_date, amount, created_at")
        .eq("company_id", company.id)
        .eq("party_id", invoice.party_id)
        .lte("recovery_date", invoice.invoice_date)
        .order("recovery_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  const invoiceAt = new Date(invoice.created_at).getTime();

  function isBeforeThisBill(entryDate: string, createdAt?: string | null) {
    if (entryDate < invoice.invoice_date) return true;
    if (entryDate > invoice.invoice_date) return false;
    if (!createdAt) return true;
    return new Date(createdAt).getTime() < invoiceAt;
  }

  const billAmount = Number(invoice.grand_total || 0);
  const paidOnThisBill = Number(invoice.amount_paid || 0);
  const paymentType = String(invoice.payment_type || "credit");
  // Balance immediately before this invoice — ignores later same-day payments/returns.
  const previousBalance = Number(balanceBeforeRaw || 0);

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

  // Shared cash walk-in shop — no account history on the print.
  const isWalkIn =
    String(party?.party_code || "").toUpperCase() === "WALKIN";

  // Last Paid Amount = last recovery on this shop (receivable), never this bill's cash.
  let lastPaidAmount = 0;
  if (!isWalkIn) {
    for (const row of recoveryRows || []) {
      if (!isBeforeThisBill(row.recovery_date, row.created_at)) continue;
      const amount = Number(row.amount || 0);
      if (amount > 0) {
        lastPaidAmount = amount;
        break;
      }
    }
  }

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
        printedAt={invoice.created_at}
        partyCode={party?.party_code}
        partyName={party?.name_en}
        partyOwner={party?.contact_person}
        partyPhone={party?.phone}
        partyMobile={party?.mobile}
        sector={sector || invoice.route || null}
        salesmanLabel={salesmanLabel || null}
        lines={(items || []).map((i) => {
          return {
            product_code: i.product_code,
            product_name: i.product_name,
            qty: Number(i.qty),
            bonus: Number(i.bonus_qty || 0),
            scheme: i.scheme,
            tradePrice: Number(i.rate),
            discount: Number(i.discount || 0),
            amount: Number(i.amount),
          };
        })}
        subtotal={Number(invoice.subtotal || 0)}
        tradeDiscount={Number(invoice.discount_total || 0)}
        extraDiscount={Number(invoice.extra_discount || 0)}
        billAmount={billAmount}
        paid={paidOnThisBill}
        paymentType={paymentType}
        previousPayment={lastPaidAmount}
        previousBalance={isWalkIn ? 0 : previousBalance}
        preparedBy={salesman?.full_name || profile?.full_name}
        autoPrint={autoPrint}
      />
    </div>
  );
}

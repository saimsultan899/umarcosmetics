import { CancelDocumentButton } from "@/components/trading/cancel-document-button";
import { SaleInvoicePrint } from "@/components/trading/sale-invoice-print";
import { requireCompanyContext } from "@/lib/auth";
import { loadSaleInvoicePrintData } from "@/lib/trading/load-sale-invoice-print";
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

  const invoice = await loadSaleInvoicePrintData(supabase, {
    companyId: company.id,
    companyName: company.name,
    companyPhone: company.phone,
    invoiceId: id,
    preparedByFallback: profile?.full_name,
  });

  if (!invoice) notFound();

  return (
    <div className="animate-rise">
      {invoice.status === "posted" ? (
        <CancelDocumentButton
          rpc="cancel_sale_invoice"
          documentId={invoice.id}
          documentNo={invoice.docNo}
        />
      ) : null}
      <SaleInvoicePrint
        companyName={invoice.companyName}
        companyPhone={invoice.companyPhone}
        docNo={invoice.docNo}
        date={invoice.date}
        printedAt={invoice.printedAt}
        partyCode={invoice.partyCode}
        partyName={invoice.partyName}
        partyOwner={invoice.partyOwner}
        partyPhone={invoice.partyPhone}
        partyMobile={invoice.partyMobile}
        sector={invoice.sector}
        salesmanLabel={invoice.salesmanLabel}
        lines={invoice.lines}
        subtotal={invoice.subtotal}
        tradeDiscount={invoice.tradeDiscount}
        extraDiscount={invoice.extraDiscount}
        billAmount={invoice.billAmount}
        paid={invoice.paid}
        paymentType={invoice.paymentType}
        previousPayment={invoice.previousPayment}
        previousBalance={invoice.previousBalance}
        preparedBy={invoice.preparedBy}
        autoPrint={autoPrint}
        isWalkIn={invoice.isWalkIn}
        companyId={invoice.companyId}
      />
    </div>
  );
}

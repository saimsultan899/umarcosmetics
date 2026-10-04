"use client";

import { Button } from "@/components/ui/button";
import { SaleInvoicePrint } from "@/components/trading/sale-invoice-print";
import { installDesktopPrint } from "@/lib/desktop-print";
import { printWithAutoPaper } from "@/lib/print/paper-size";
import type { SaleInvoicePrintData } from "@/lib/trading/load-sale-invoice-print";
import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

export function SaleInvoicesBatchPrint({
  invoices,
  autoPrint = true,
}: {
  invoices: SaleInvoicePrintData[];
  autoPrint?: boolean;
}) {
  const savedTitle = useRef("");

  useEffect(() => {
    installDesktopPrint();
  }, []);

  useEffect(() => {
    const onBeforePrint = () => {
      savedTitle.current = document.title;
      document.title = " ";
    };
    const onAfterPrint = () => {
      document.title = savedTitle.current;
    };
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, []);

  function printAll() {
    printWithAutoPaper("a5");
  }

  useEffect(() => {
    if (!autoPrint || invoices.length === 0) return;
    const t = window.setTimeout(() => printAll(), 400);
    return () => window.clearTimeout(t);
  }, [autoPrint, invoices.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "p") {
        return;
      }
      event.preventDefault();
      printAll();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto text-sm text-[var(--muted)]">
          {invoices.length} sale invoice{invoices.length === 1 ? "" : "s"} selected
          · Half A4 · one page each
        </p>
        <Link
          href="/sales/invoices"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-3 text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-2)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to list
        </Link>
        <Button type="button" onClick={printAll}>
          <Printer className="h-4 w-4" />
          Print selected ({invoices.length})
        </Button>
      </div>

      <div className="batch-sale-prints">
        {invoices.map((inv) => (
          <SaleInvoicePrint
            key={inv.id}
            companyName={inv.companyName}
            companyPhone={inv.companyPhone}
            companyId={inv.companyId}
            docNo={inv.docNo}
            date={inv.date}
            printedAt={inv.printedAt}
            partyCode={inv.partyCode}
            partyName={inv.partyName}
            partyOwner={inv.partyOwner}
            partyPhone={inv.partyPhone}
            partyMobile={inv.partyMobile}
            sector={inv.sector}
            salesmanLabel={inv.salesmanLabel}
            lines={inv.lines}
            subtotal={inv.subtotal}
            tradeDiscount={inv.tradeDiscount}
            extraDiscount={inv.extraDiscount}
            billAmount={inv.billAmount}
            paid={inv.paid}
            paymentType={inv.paymentType}
            previousPayment={inv.previousPayment}
            previousBalance={inv.previousBalance}
            preparedBy={inv.preparedBy}
            isWalkIn={inv.isWalkIn}
            embedded
            forceStandard
            autoPrint={false}
          />
        ))}
      </div>
    </div>
  );
}

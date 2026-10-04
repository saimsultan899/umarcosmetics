"use client";

import { Button } from "@/components/ui/button";
import { SaleInvoicePrint } from "@/components/trading/sale-invoice-print";
import { installDesktopPrint } from "@/lib/desktop-print";
import { printWithAutoPaper } from "@/lib/print/paper-size";
import type { SaleInvoicePrintData } from "@/lib/trading/load-sale-invoice-print";
import { cn } from "@/lib/utils";
import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export function SaleInvoicesBatchPrint({
  invoices,
  autoPrint = true,
}: {
  invoices: SaleInvoicePrintData[];
  autoPrint?: boolean;
}) {
  const savedTitle = useRef("");
  const didAutoPrint = useRef(false);
  const [paperSize, setPaperSize] = useState<"a5" | "a4">("a5");

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
    printWithAutoPaper(paperSize);
  }

  useEffect(() => {
    if (!autoPrint || invoices.length === 0 || didAutoPrint.current) return;
    didAutoPrint.current = true;
    const t = window.setTimeout(() => printWithAutoPaper(paperSize), 400);
    return () => window.clearTimeout(t);
  }, [autoPrint, invoices.length, paperSize]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "p") {
        return;
      }
      event.preventDefault();
      printWithAutoPaper(paperSize);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [paperSize]);

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto text-sm text-[var(--muted)]">
          {invoices.length} sale invoice{invoices.length === 1 ? "" : "s"} selected
          · {paperSize === "a4" ? "A4 full page" : "A5 half slip"} · one invoice
          per page
        </p>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-white p-0.5">
          <button
            type="button"
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-semibold",
              paperSize === "a5"
                ? "bg-[var(--brand)] text-white"
                : "text-[var(--muted)] hover:text-[var(--ink)]",
            )}
            onClick={() => setPaperSize("a5")}
          >
            A5
          </button>
          <button
            type="button"
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-semibold",
              paperSize === "a4"
                ? "bg-[var(--brand)] text-white"
                : "text-[var(--muted)] hover:text-[var(--ink)]",
            )}
            onClick={() => setPaperSize("a4")}
            title="Full A4 when invoices have many product lines"
          >
            A4 full
          </button>
        </div>
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
            paperSize={paperSize}
            autoPrint={false}
          />
        ))}
      </div>
    </div>
  );
}

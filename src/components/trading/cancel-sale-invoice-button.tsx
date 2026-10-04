"use client";

import { CancelDocumentButton } from "@/components/trading/cancel-document-button";

/** @deprecated Prefer CancelDocumentButton with rpc="cancel_sale_invoice". */
export function CancelSaleInvoiceButton({
  invoiceId,
  invoiceNo,
}: {
  invoiceId: string;
  invoiceNo: string;
}) {
  return (
    <CancelDocumentButton
      rpc="cancel_sale_invoice"
      documentId={invoiceId}
      documentNo={invoiceNo}
    />
  );
}

"use client";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CancelSaleInvoiceButton({
  invoiceId,
  invoiceNo,
}: {
  invoiceId: string;
  invoiceNo: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancelInvoice() {
    const proceed = window.confirm(
      `Cancel ${invoiceNo}?\n\nThe customer balance and the stock go back to where they were before this bill. Use this when the quantity was entered by mistake.`,
    );
    if (!proceed) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("cancel_sale_invoice", {
      p_invoice_id: invoiceId,
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.push("/sales/invoices");
    router.refresh();
  }

  return (
    <div className="mb-4">
      <Button
        type="button"
        variant="secondary"
        loading={loading}
        onClick={() => void cancelInvoice()}
      >
        Cancel this invoice
      </Button>
      {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}

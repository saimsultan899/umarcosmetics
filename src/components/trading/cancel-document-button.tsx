"use client";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type CancelRpc =
  | "cancel_sale_invoice"
  | "cancel_purchase_invoice"
  | "cancel_sale_return"
  | "cancel_purchase_return";

const CANCEL_COPY: Record<
  CancelRpc,
  { label: string; body: string; redirect: string; param: string }
> = {
  cancel_sale_invoice: {
    label: "Update / fix this invoice",
    body: "Customer balance and stock go back to before this bill. Then create the correct invoice.",
    redirect: "/sales/invoices",
    param: "p_invoice_id",
  },
  cancel_purchase_invoice: {
    label: "Update / fix this purchase",
    body: "Supplier balance and stock go back to before this bill. Then create the correct purchase.",
    redirect: "/purchases/invoices",
    param: "p_invoice_id",
  },
  cancel_sale_return: {
    label: "Update / fix this return",
    body: "Customer balance and stock go back to before this return. Then create the correct return.",
    redirect: "/sales/returns",
    param: "p_return_id",
  },
  cancel_purchase_return: {
    label: "Update / fix this return",
    body: "Supplier balance and stock go back to before this return. Then create the correct return.",
    redirect: "/purchases/returns",
    param: "p_return_id",
  },
};

export function CancelDocumentButton({
  rpc,
  documentId,
  documentNo,
}: {
  rpc: CancelRpc;
  documentId: string;
  documentNo: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = CANCEL_COPY[rpc];

  async function cancelDocument() {
    const proceed = window.confirm(`Update / fix ${documentNo}?\n\n${copy.body}`);
    if (!proceed) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc(rpc, {
      [copy.param]: documentId,
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.push(copy.redirect);
    router.refresh();
  }

  return (
    <div className="mb-4 no-print rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
      <p className="text-sm font-medium text-amber-950">
        Entered wrong? Use Update to reverse this entry, then create the correct one.
      </p>
      <p className="mt-1 text-xs text-amber-900/80">{copy.body}</p>
      <div className="mt-3">
        <Button
          type="button"
          variant="secondary"
          loading={loading}
          onClick={() => void cancelDocument()}
        >
          {copy.label}
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}

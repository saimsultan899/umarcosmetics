"use client";

import { PostedDocumentEditor } from "@/components/trading/posted-document-editor";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useSingleSubmit } from "@/lib/forms/single-submit";
import { useState } from "react";

type CancelRpc =
  | "cancel_sale_invoice"
  | "cancel_purchase_invoice"
  | "cancel_sale_return"
  | "cancel_purchase_return";

const CANCEL_COPY: Record<
  CancelRpc,
  { body: string; redirect: string; param: string; table: string; wide: boolean }
> = {
  cancel_sale_invoice: {
    body: "Stock goes back and the customer balance is reversed.",
    redirect: "/sales/invoices",
    param: "p_invoice_id",
    table: "sale_invoices",
    wide: true,
  },
  cancel_purchase_invoice: {
    body: "Stock goes back and the supplier balance is reversed.",
    redirect: "/purchases/invoices",
    param: "p_invoice_id",
    table: "purchase_invoices",
    wide: true,
  },
  cancel_sale_return: {
    body: "Stock and the customer balance go back to before this return.",
    redirect: "/sales/returns",
    param: "p_return_id",
    table: "sale_returns",
    wide: true,
  },
  cancel_purchase_return: {
    body: "Stock and the supplier balance go back to before this return.",
    redirect: "/purchases/returns",
    param: "p_return_id",
    table: "purchase_returns",
    wide: true,
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
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const singleSubmit = useSingleSubmit();
  const [error, setError] = useState<string | null>(null);
  const copy = CANCEL_COPY[rpc];

  async function deleteDocument() {
    await singleSubmit(async () => {
    const proceed = window.confirm(`Delete ${documentNo}?\n\n${copy.body}`);
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
    });
  }

  return (
    <div className="mb-4 no-print rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
      <p className="text-sm font-medium text-[var(--ink)]">
        Edit {documentNo} in the same form, or delete it if it should not stay on the books.
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">{copy.body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={loading}
          onClick={() => void deleteDocument()}
        >
          Delete
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title={`Edit ${documentNo}`}
        className={
          copy.wide
            ? "max-w-[96vw] sm:max-w-6xl lg:max-w-7xl xl:max-w-[1360px]"
            : undefined
        }
      >
        {editing ? (
          <PostedDocumentEditor
            table={copy.table}
            id={documentId}
            onDone={() => {
              setEditing(false);
              router.refresh();
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

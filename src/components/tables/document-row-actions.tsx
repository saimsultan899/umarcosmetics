"use client";

import {
  PostedDocumentEditor,
  postedEditIsWide,
} from "@/components/trading/posted-document-editor";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { deleteCachedRow, type CacheStoreName } from "@/lib/offline/local-db";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const CANCEL_RPC: Record<
  string,
  { rpc: string; param: string; title: string; description: string }
> = {
  sale_invoices: {
    rpc: "cancel_sale_invoice",
    param: "p_invoice_id",
    title: "Delete this sale invoice?",
    description:
      "Stock goes back and the customer balance is reversed. The invoice number stays unused in the list.",
  },
  purchase_invoices: {
    rpc: "cancel_purchase_invoice",
    param: "p_invoice_id",
    title: "Delete this purchase invoice?",
    description:
      "Stock goes back and the supplier balance is reversed.",
  },
  sale_returns: {
    rpc: "cancel_sale_return",
    param: "p_return_id",
    title: "Delete this sale return?",
    description:
      "Stock and the customer balance go back to before this return.",
  },
  purchase_returns: {
    rpc: "cancel_purchase_return",
    param: "p_return_id",
    title: "Delete this purchase return?",
    description:
      "Stock and the supplier balance go back to before this return.",
  },
  recoveries: {
    rpc: "cancel_recovery",
    param: "p_recovery_id",
    title: "Delete this recovery?",
    description:
      "The customer balance goes back up by this amount.",
  },
  vouchers: {
    rpc: "cancel_voucher",
    param: "p_voucher_id",
    title: "Delete this voucher?",
    description:
      "Party balances go back to before this voucher.",
  },
};

const NEVER_HARD_DELETE = new Set([
  "sale_invoices",
  "purchase_invoices",
  "vouchers",
  "sale_returns",
  "purchase_returns",
  "recoveries",
  "sale_invoice_items",
  "purchase_invoice_items",
  "voucher_lines",
]);

export function DocumentRowActions({
  title,
  fields,
  href,
  table,
  id,
  linesTable,
  linesFk,
  allowDelete = true,
  showPrint = false,
}: {
  title: string;
  fields: DetailField[];
  href: string;
  table: string;
  id: string;
  linesTable?: string;
  linesFk?: string;
  allowDelete?: boolean;
  showPrint?: boolean;
}) {
  const router = useRouter();
  const cancel = CANCEL_RPC[table];
  const canReverse = allowDelete && Boolean(cancel);
  const canHardDelete = allowDelete && !NEVER_HARD_DELETE.has(table) && !cancel;

  async function cancelEntry() {
    if (!cancel) return;
    const supabase = createClient();
    const { error } = await supabase.rpc(cancel.rpc, { [cancel.param]: id });
    if (error) throw new Error(error.message);
  }

  async function hardDelete() {
    try {
      const supabase = createClient();
      if (linesTable && linesFk) {
        const { error: linesError } = await supabase
          .from(linesTable)
          .delete()
          .eq(linesFk, id);
        if (linesError) throw new Error(linesError.message);
      }
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw new Error(error.message);
    } catch (err) {
      if (typeof window !== "undefined" && !navigator.onLine) {
        try {
          await deleteCachedRow(table as CacheStoreName, id);
        } catch {
          // Ignore cache deletion failure
        }
        return;
      }
      throw err;
    }
  }

  return (
    <RowActions
      viewTitle={title}
      viewFields={fields}
      href={href}
      printHref={showPrint ? href : undefined}
      editTitle={`Edit ${title}`}
      editClassName={
        postedEditIsWide(table)
          ? "max-w-[96vw] sm:max-w-6xl lg:max-w-7xl xl:max-w-[1360px]"
          : undefined
      }
      allowEdit={canReverse}
      editContent={
        canReverse
          ? (close) => (
              <PostedDocumentEditor
                table={table}
                id={id}
                onDone={() => {
                  close();
                  router.refresh();
                }}
              />
            )
          : undefined
      }
      allowCancel={false}
      allowDelete={canReverse || canHardDelete}
      onDelete={canReverse ? cancelEntry : canHardDelete ? hardDelete : undefined}
      deleteTitle={cancel?.title || `Delete ${title}?`}
      deleteDescription={
        cancel?.description ||
        "This permanently removes the document. Stock and ledger effects are not auto-reversed."
      }
      deleteConfirmLabel={canReverse ? "Delete entry" : "Delete permanently"}
    />
  );
}

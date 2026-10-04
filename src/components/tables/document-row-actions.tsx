"use client";

import { DetailField, RowActions } from "@/components/ui/row-actions";
import { deleteCachedRow, type CacheStoreName } from "@/lib/offline/local-db";
import { createClient } from "@/lib/supabase/client";

const CANCEL_RPC: Record<
  string,
  { rpc: string; param: string; title: string; description: string }
> = {
  sale_invoices: {
    rpc: "cancel_sale_invoice",
    param: "p_invoice_id",
    title: "Update / fix this sale invoice?",
    description:
      "Customer balance and stock go back to before this bill. Then create the correct invoice.",
  },
  purchase_invoices: {
    rpc: "cancel_purchase_invoice",
    param: "p_invoice_id",
    title: "Update / fix this purchase invoice?",
    description:
      "Supplier balance and stock go back to before this bill. Then create the correct purchase.",
  },
  sale_returns: {
    rpc: "cancel_sale_return",
    param: "p_return_id",
    title: "Update / fix this sale return?",
    description:
      "Customer balance and stock go back to before this return. Then create the correct return.",
  },
  purchase_returns: {
    rpc: "cancel_purchase_return",
    param: "p_return_id",
    title: "Update / fix this purchase return?",
    description:
      "Supplier balance and stock go back to before this return. Then create the correct return.",
  },
  recoveries: {
    rpc: "cancel_recovery",
    param: "p_recovery_id",
    title: "Update / fix this recovery?",
    description:
      "Customer balance goes back up by this amount. Then enter the correct collection if needed.",
  },
  vouchers: {
    rpc: "cancel_voucher",
    param: "p_voucher_id",
    title: "Update / fix this voucher?",
    description:
      "Party balance goes back to before this cash receipt or payment. Then enter the correct voucher.",
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
  const cancel = CANCEL_RPC[table];
  const canCancel = allowDelete && Boolean(cancel);
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
      allowEdit={false}
      allowCancel={canCancel}
      onCancel={canCancel ? cancelEntry : undefined}
      cancelLabel="Update"
      cancelTitle={cancel?.title}
      cancelDescription={cancel?.description}
      allowDelete={canHardDelete}
      onDelete={canHardDelete ? hardDelete : undefined}
      deleteTitle={`Delete ${title}?`}
      deleteDescription="This permanently removes the document. Stock and ledger effects are not auto-reversed."
    />
  );
}

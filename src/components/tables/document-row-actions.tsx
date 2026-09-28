"use client";

import { DetailField, RowActions } from "@/components/ui/row-actions";
import { deleteCachedRow, type CacheStoreName } from "@/lib/offline/local-db";
import { createClient } from "@/lib/supabase/client";

const NEVER_DELETE = new Set([
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
  const canDelete = allowDelete && !NEVER_DELETE.has(table);

  async function remove() {
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
      allowDelete={canDelete}
      onDelete={canDelete ? remove : undefined}
      deleteTitle={`Delete ${title}?`}
      deleteDescription="This permanently removes the document. Stock and ledger effects are not auto-reversed."
    />
  );
}

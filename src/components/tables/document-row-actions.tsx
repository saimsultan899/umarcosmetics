"use client";

import { DetailField, RowActions } from "@/components/ui/row-actions";
import { createClient } from "@/lib/supabase/client";

export function DocumentRowActions({
  title,
  fields,
  href,
  table,
  id,
  linesTable,
  linesFk,
  allowDelete = true,
}: {
  title: string;
  fields: DetailField[];
  href: string;
  table: string;
  id: string;
  linesTable?: string;
  linesFk?: string;
  allowDelete?: boolean;
}) {
  async function remove() {
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
  }

  return (
    <RowActions
      viewTitle={title}
      viewFields={fields}
      href={href}
      allowEdit={false}
      allowDelete={allowDelete}
      onDelete={allowDelete ? remove : undefined}
      deleteTitle={`Delete ${title}?`}
      deleteDescription="This permanently removes the document. Stock and ledger effects are not auto-reversed."
    />
  );
}

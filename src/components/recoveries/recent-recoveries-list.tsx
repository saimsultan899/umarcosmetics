"use client";

import { PostedDocumentEditor } from "@/components/trading/posted-document-editor";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { createClient } from "@/lib/supabase/client";
import { formatPkr } from "@/lib/utils";
import { useRouter } from "next/navigation";

export type RecentRecoveryRow = {
  id: string;
  recovery_date: string;
  amount: number;
  remarks: string | null;
  parties: { party_code: string; name_en: string } | null;
};

export function RecentRecoveriesList({
  rows,
  canEdit = true,
}: {
  rows: RecentRecoveryRow[];
  canEdit?: boolean;
}) {
  const router = useRouter();

  async function cancelRecovery(id: string) {
    const supabase = createClient();
    const { error } = await supabase.rpc("cancel_recovery", {
      p_recovery_id: id,
    });
    if (error) throw new Error(error.message);
  }

  if (!rows.length) {
    return (
      <p className="text-sm text-[var(--muted)]">No recoveries recorded yet.</p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {rows.map((r) => {
        const party = r.parties
          ? `${r.parties.party_code} — ${r.parties.name_en}`
          : "—";
        const fields: DetailField[] = [
          { label: "Date", value: r.recovery_date },
          { label: "Customer", value: party },
          { label: "Amount", value: formatPkr(r.amount) },
          { label: "Remarks", value: r.remarks || "—" },
        ];
        return (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <p className="font-medium">{party}</p>
              <p className="text-xs text-[var(--muted)]">
                {r.recovery_date}
                {r.remarks ? ` · ${r.remarks}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-emerald-700">
                {formatPkr(r.amount)}
              </p>
              <RowActions
                viewTitle="Recovery details"
                viewFields={fields}
                editTitle={`Edit recovery — ${party}`}
                editClassName="sm:max-w-3xl"
                allowEdit={canEdit}
                editContent={
                  canEdit
                    ? (close) => (
                        <PostedDocumentEditor
                          table="recoveries"
                          id={r.id}
                          onDone={() => {
                            close();
                            router.refresh();
                          }}
                        />
                      )
                    : undefined
                }
                allowCancel={false}
                allowDelete={canEdit}
                deleteTitle="Delete this recovery?"
                deleteDescription={`Reverse ${formatPkr(r.amount)} for ${party}. The customer receivable goes back up by that amount.`}
                deleteConfirmLabel="Delete entry"
                onDelete={() => cancelRecovery(r.id)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

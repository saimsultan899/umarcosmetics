"use client";

import { PostedDocumentEditor } from "@/components/trading/posted-document-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { formatPkr } from "@/lib/utils";
import { Pencil, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type RecoveryHit = {
  id: string;
  recovery_date: string;
  amount: number;
  remarks: string;
  created_at: string;
};

function whenLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit" });
}

export function PartyRecoveriesManager({
  companyId,
  partyId,
  partyLabel,
  onDone,
}: {
  companyId: string;
  partyId: string;
  partyLabel: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<RecoveryHit[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .from("recoveries")
      .select("id, recovery_date, amount, remarks, created_at")
      .eq("company_id", companyId)
      .eq("party_id", partyId)
      .order("recovery_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);
    if (loadError) {
      setError(loadError.message);
      setRows([]);
    } else {
      setRows(
        (data || []).map((row) => ({
          id: String(row.id),
          recovery_date: String(row.recovery_date || ""),
          amount: Number(row.amount || 0),
          remarks: String(row.remarks || ""),
          created_at: String(row.created_at || ""),
        })),
      );
    }
    setLoading(false);
  }, [companyId, partyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.recovery_date}|${row.amount.toFixed(2)}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return new Set(
      [...counts.entries()].filter(([, n]) => n > 1).map(([key]) => key),
    );
  }, [rows]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => {
      const time = whenLabel(row.created_at);
      return [row.recovery_date, row.amount.toFixed(2), row.remarks, time]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [rows, query]);

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase.rpc("cancel_recovery", {
      p_recovery_id: id,
    });
    setBusyId(null);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setPendingDelete(null);
    await load();
    router.refresh();
  }

  if (editingId) {
    return (
      <div className="space-y-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            setEditingId(null);
            void load();
          }}
        >
          Back to list
        </Button>
        <PostedDocumentEditor
          table="recoveries"
          id={editingId}
          onDone={() => {
            setEditingId(null);
            void load();
            router.refresh();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--muted)]">
        All recoveries for <span className="font-medium text-[var(--ink)]">{partyLabel}</span>.
        Search, edit, or delete a duplicate. Deleting puts that amount back on the shop balance.
      </p>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search date, amount, remarks..."
          className="pl-9"
          autoFocus
        />
      </div>
      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}
      {loading ? (
        <p className="text-sm text-[var(--muted)]">Loading recoveries...</p>
      ) : filtered.length ? (
        <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {filtered.map((row) => {
            const dup = duplicateKeys.has(
              `${row.recovery_date}|${row.amount.toFixed(2)}`,
            );
            const time = whenLabel(row.created_at);
            const confirming = pendingDelete === row.id;
            return (
              <li
                key={row.id}
                className="rounded-xl border border-[var(--border)] px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {row.recovery_date}
                      {time ? ` · ${time}` : ""} · {formatPkr(row.amount)}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {row.remarks || "No remarks"}
                      {dup ? " · Possible duplicate (same date and amount)" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingId(row.id)}
                      aria-label="Edit recovery"
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-rose-600 hover:text-rose-700"
                      loading={busyId === row.id}
                      onClick={() =>
                        setPendingDelete(confirming ? null : row.id)
                      }
                      aria-label="Delete recovery"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {confirming ? (
                  <div className="mt-2 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-2">
                    <p className="mr-auto text-xs text-[var(--muted)]">
                      Reverse {formatPkr(row.amount)}? The receivable goes back up.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busyId === row.id}
                      onClick={() => setPendingDelete(null)}
                    >
                      Keep
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      loading={busyId === row.id}
                      onClick={() => void remove(row.id)}
                    >
                      Delete entry
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-[var(--muted)]">
          {rows.length ? "No recoveries match this search." : "No recoveries for this shop."}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          Close
        </Button>
      </div>
    </div>
  );
}

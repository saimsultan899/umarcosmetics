"use client";

import { TableScroll } from "@/components/tables/table-scroll";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { Copy, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type SalesmanInviteRow = {
  id: string;
  email: string;
  full_name: string | null;
  token: string;
  claimed_by: string | null;
  created_at: string;
};

export function SalesmanInvitesTable({ rows }: { rows: SalesmanInviteRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cancelInvite(id: string) {
    setBusyId(id);
    setError(null);
    const supabase = createClient();
    const { error: delError } = await supabase
      .from("salesman_invites")
      .delete()
      .eq("id", id)
      .is("claimed_by", null);
    setBusyId(null);
    if (delError) {
      setError(delError.message);
      return;
    }
    router.refresh();
  }

  async function copyLink(row: SalesmanInviteRow) {
    const url = `${window.location.origin}/join/${row.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(row.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setError("Could not copy link");
    }
  }

  if (!rows.length) return null;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
          Login invites
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Optional — only if a salesman needs field-app access.
        </p>
      </div>
      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <div className="table-shell">
        <TableScroll>
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Status</th>
                <th>Created</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td className="font-medium">{i.email}</td>
                  <td>{i.full_name || "—"}</td>
                  <td>
                    {i.claimed_by ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                        Claimed
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="text-sm text-[var(--muted)]">
                    {i.created_at?.slice(0, 10) || "—"}
                  </td>
                  <td>
                    <div className="flex flex-nowrap items-center justify-end gap-0.5">
                      {!i.claimed_by ? (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 shrink-0 p-0"
                            onClick={() => void copyLink(i)}
                            aria-label="Copy invite link"
                            title={copiedId === i.id ? "Copied" : "Copy link"}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 shrink-0 p-0 text-rose-600 hover:text-rose-700"
                            disabled={busyId === i.id}
                            onClick={() => void cancelInvite(i.id)}
                            aria-label="Cancel invite"
                            title="Cancel invite"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </div>
    </div>
  );
}

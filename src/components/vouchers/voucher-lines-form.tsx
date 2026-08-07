"use client";

import { PartyCodeCell } from "@/components/forms/party-code-cell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import type { Party } from "@/lib/types/database";
import { formatPkr } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type Line = {
  key: string;
  party_id: string;
  amount: string;
  narration: string;
};

function emptyLine(): Line {
  return { key: crypto.randomUUID(), party_id: "", amount: "", narration: "" };
}

export function CashVoucherForm({
  kind,
  companyId,
  organizationId,
  parties,
}: {
  kind: "CR" | "CP";
  companyId: string;
  organizationId: string;
  parties: Party[];
}) {
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = lines.reduce((s, l) => s + Number(l.amount || 0), 0);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const valid = lines.filter((l) => l.party_id && Number(l.amount) > 0);
    if (valid.length === 0) {
      setError("Add at least one party line with amount.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const rpc = kind === "CR" ? "create_cash_receipt" : "create_cash_payment";
    const { data, error: rpcError } = await supabase.rpc(rpc, {
      p_payload: {
        organization_id: organizationId,
        company_id: companyId,
        voucher_date: date,
        narration,
        lines: valid.map((l) => ({
          party_id: l.party_id,
          amount: Number(l.amount),
          narration: l.narration || null,
        })),
      },
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.push(`/vouchers/${kind === "CR" ? "cash-receipt" : "cash-payment"}/${data}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div>
          <Label>Narration</Label>
          <Input value={narration} onChange={(e) => setNarration(e.target.value)} />
        </div>
      </div>

      <div className="table-grid">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="bg-[var(--surface-2)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
              <th className="px-3 py-2">Party</th>
              <th className="px-3 py-2 w-36">Amount</th>
              <th className="px-3 py-2">Narration</th>
              <th className="px-3 py-2 w-12" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">
                  <PartyCodeCell
                    companyId={companyId}
                    parties={parties}
                    value={line.party_id}
                    onChange={(partyId) =>
                      setLines((prev) =>
                        prev.map((l) =>
                          l.key === line.key ? { ...l, party_id: partyId } : l,
                        ),
                      )
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.amount}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l) =>
                          l.key === line.key ? { ...l, amount: e.target.value } : l,
                        ),
                      )
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={line.narration}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l) =>
                          l.key === line.key ? { ...l, narration: e.target.value } : l,
                        ),
                      )
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="rounded-lg p-2 text-rose-600 hover:bg-rose-50"
                    onClick={() =>
                      setLines((prev) =>
                        prev.length <= 1
                          ? [emptyLine()]
                          : prev.filter((l) => l.key !== line.key),
                      )
                    }
                    aria-label="Remove line"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => setLines((p) => [...p, emptyLine()])}>
          <Plus className="h-4 w-4" />
          Add line
        </Button>
        <p className="text-sm font-semibold">Total {formatPkr(total)}</p>
      </div>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <Button type="submit" disabled={loading}>
        {loading ? "Posting..." : kind === "CR" ? "Save cash receipt" : "Save cash payment"}
      </Button>
    </form>
  );
}

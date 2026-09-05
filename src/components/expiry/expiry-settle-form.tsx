"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import { createClient } from "@/lib/supabase/client";
import { formatNumber, formatPkr } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

export type SettleClaimLine = {
  id: string;
  product_code: string;
  product_name: string;
  qty: number;
  amount: number;
};

export function ExpirySettleForm({
  companyId,
  organizationId,
  claimId,
  lines,
}: {
  companyId: string;
  organizationId: string;
  claimId: string;
  lines: SettleClaimLine[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"financial" | "physical" | "mixed">(
    "financial",
  );
  const [settlementDate, setSettlementDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [narration, setNarration] = useState("");
  const [acceptedQty, setAcceptedQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, String(l.qty)])),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolved = useMemo(() => {
    return lines.map((l) => {
      let acc = l.qty;
      let rej = 0;
      if (kind === "physical") {
        acc = 0;
        rej = l.qty;
      } else if (kind === "mixed") {
        acc = Math.min(l.qty, Math.max(0, Number(acceptedQty[l.id] || 0)));
        rej = Math.round((l.qty - acc) * 1000) / 1000;
      }
      const accAmt =
        l.qty > 0 ? Math.round(l.amount * (acc / l.qty) * 100) / 100 : 0;
      const rejAmt = Math.round((l.amount - accAmt) * 100) / 100;
      return { ...l, acc, rej, accAmt, rejAmt };
    });
  }, [acceptedQty, kind, lines]);

  const acceptedTotal = resolved.reduce((s, l) => s + l.accAmt, 0);
  const rejectedTotal = resolved.reduce((s, l) => s + l.rejAmt, 0);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("settle_expiry_claim", {
      p_payload: {
        organization_id: organizationId,
        company_id: companyId,
        claim_id: claimId,
        settlement_date: settlementDate,
        narration,
        items: resolved.map((l) => ({
          claim_item_id: l.id,
          accepted_qty: l.acc,
          rejected_qty: l.rej,
          accepted_amount: l.accAmt,
          rejected_amount: l.rejAmt,
        })),
      },
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="no-print space-y-4 rounded-xl border border-[var(--border)] bg-white p-4"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >
      <div>
        <h2 className="text-base font-semibold text-[var(--ink)]">Settlement</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          The company may accept some items and send others back. Accepted value
          stays as a vendor credit. Rejected qty returns to expiry warehouse.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["financial", "Financial settlement"],
            ["physical", "Physical return"],
            ["mixed", "Mixed"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setKind(value)}
            className={
              kind === value
                ? "rounded-md bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white"
                : "rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)]"
            }
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Settlement date</Label>
          <Input
            type="date"
            value={settlementDate}
            onChange={(e) => setSettlementDate(e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Narration</Label>
          <Input
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder={
              kind === "physical"
                ? "Company rejected and returned the goods"
                : "Company accepted expiry claim"
            }
          />
        </div>
      </div>

      {kind === "mixed" ? (
        <div className="table-grid">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th>Item</th>
                <th className="w-24">Sent</th>
                <th className="w-28">Accepted qty</th>
                <th className="w-24">Rejected</th>
              </tr>
            </thead>
            <tbody>
              {resolved.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2">
                    {l.product_code} {l.product_name}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatNumber(l.qty, 2)}
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      type="number"
                      min="0"
                      max={l.qty}
                      step="0.001"
                      value={acceptedQty[l.id] ?? ""}
                      onChange={(e) =>
                        setAcceptedQty((prev) => ({
                          ...prev,
                          [l.id]: e.target.value,
                        }))
                      }
                    />
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatNumber(l.rej, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>Accepted credit {formatPkr(acceptedTotal)}</span>
        <span>Returned to expiry {formatPkr(rejectedTotal)}</span>
      </div>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <Button type="submit" disabled={loading}>
        {loading ? "Posting..." : "Post settlement"}
      </Button>
    </form>
  );
}

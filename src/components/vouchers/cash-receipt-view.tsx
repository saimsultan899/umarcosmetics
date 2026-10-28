"use client";

import { DetailField, DetailGrid } from "@/components/ui/row-actions";
import { createClient } from "@/lib/supabase/client";
import { formatPkr } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";

type ViewLine = {
  id: string;
  partyCode: string;
  partyName: string;
  sector: string;
  amount: number;
  remarks: string;
};

export function CashReceiptView({
  voucherId,
  companyId,
  fields,
}: {
  voucherId: string;
  companyId: string;
  fields: DetailField[];
}) {
  const [lines, setLines] = useState<ViewLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const supabase = createClient();
        const { data, error: lineErr } = await supabase
          .from("voucher_lines")
          .select(
            "id, party_id, amount, narration, sort_order, parties!voucher_lines_party_id_fkey(party_code, name_en, route)",
          )
          .eq("voucher_id", voucherId)
          .eq("company_id", companyId)
          .order("sort_order", { ascending: true });
        if (lineErr) throw new Error(lineErr.message);
        if (cancelled) return;
        const byParty = new Map<string, ViewLine>();
        for (const row of data || []) {
          const party = Array.isArray(row.parties) ? row.parties[0] : row.parties;
          const p = party as
            | { party_code?: string; name_en?: string; route?: string | null }
            | null
            | undefined;
          const partyKey = String(row.party_id || row.id);
          const amount = Number(row.amount || 0);
          const remarks = String(row.narration || "").trim();
          const prev = byParty.get(partyKey);
          if (!prev) {
            byParty.set(partyKey, {
              id: String(row.id),
              partyCode: String(p?.party_code || ""),
              partyName: String(p?.name_en || "—"),
              sector: String(p?.route || "").trim() || "No sector",
              amount,
              remarks,
            });
          } else {
            byParty.set(partyKey, {
              ...prev,
              amount: prev.amount + amount,
              remarks: remarks || prev.remarks,
            });
          }
        }
        setLines([...byParty.values()]);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load shops.");
          setLines([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [voucherId, companyId]);

  const bySector = useMemo(() => {
    const map = new Map<string, ViewLine[]>();
    for (const line of lines) {
      const list = map.get(line.sector) || [];
      list.push(line);
      map.set(line.sector, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [lines]);

  const total = lines.reduce((sum, line) => sum + line.amount, 0);

  return (
    <div className="space-y-5">
      <DetailGrid fields={fields} />

      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--ink)]">
            Shops on this receipt
          </h3>
          <p className="text-xs text-[var(--muted)]">
            {loading
              ? "Loading…"
              : `${lines.length} shop${lines.length === 1 ? "" : "s"} · ${formatPkr(total)}`}
          </p>
        </div>

        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {!loading && !error && lines.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No shop lines on this receipt.</p>
        ) : null}

        <div className="space-y-4">
          {bySector.map(([sector, sectorLines]) => {
            const sectorTotal = sectorLines.reduce((s, l) => s + l.amount, 0);
            return (
              <div key={sector} className="overflow-hidden rounded-xl border border-[var(--border)]">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-[var(--surface-2)] px-3 py-2">
                  <p className="text-sm font-semibold">{sector}</p>
                  <p className="text-xs font-medium text-[var(--muted)]">
                    {sectorLines.length} shop
                    {sectorLines.length === 1 ? "" : "s"} · {formatPkr(sectorTotal)}
                  </p>
                </div>
                <div className="table-grid">
                  <table className="w-full min-w-[28rem] text-sm">
                    <thead>
                      <tr>
                        <th className="w-20">Code</th>
                        <th>Customer</th>
                        <th className="w-28 text-right">Amount</th>
                        <th>Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sectorLines.map((line) => (
                        <tr key={line.id} className="border-t border-[var(--border)]">
                          <td className="font-mono text-[11px] font-semibold tabular-nums">
                            {line.partyCode || "—"}
                          </td>
                          <td className="max-w-[14rem] truncate" title={line.partyName}>
                            {line.partyName}
                          </td>
                          <td className="text-right font-semibold tabular-nums">
                            {formatPkr(line.amount)}
                          </td>
                          <td className="max-w-[12rem] truncate text-[var(--muted)]" title={line.remarks}>
                            {line.remarks || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

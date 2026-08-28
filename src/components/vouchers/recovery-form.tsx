"use client";

import { PartyCodePicker } from "@/components/forms/party-code-picker";
import { SalesmanSelect } from "@/components/forms/salesman-select";
import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { focusField, handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import { createClient } from "@/lib/supabase/client";
import type { Party } from "@/lib/types/database";
import type { SalesmanOption } from "@/lib/queries/salesmen";
import { formatPkr } from "@/lib/utils";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

type RecoveryLine = {
  key: string;
  partyId: string;
  partyCode: string;
  partyName: string;
  amount: number;
  remarks: string;
};

function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function RecoveryForm({
  companyId,
  organizationId,
  parties,
  salesmen = [],
  onDone,
}: {
  companyId: string;
  organizationId: string;
  parties: Party[];
  salesmen?: SalesmanOption[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  const amountId = useId();
  const remarksId = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const remarksRef = useRef<HTMLInputElement>(null);

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [salesmanId, setSalesmanId] = useState("");
  const [partyId, setPartyId] = useState("");
  const [party, setParty] = useState<Party | null>(null);
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [lines, setLines] = useState<RecoveryLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadBalance(id: string) {
      if (!id) {
        setBalance(null);
        return;
      }
      const supabase = createClient();
      const { data } = await supabase.rpc("get_party_balance", {
        p_company_id: companyId,
        p_party_id: id,
        p_as_of: date,
      });
      if (!cancelled) setBalance(data == null ? null : Number(data));
    }
    void loadBalance(partyId);
    return () => {
      cancelled = true;
    };
  }, [companyId, partyId, date]);

  function clearDraft(focusCode = true) {
    setPartyId("");
    setParty(null);
    setAmount("");
    setRemarks("");
    setBalance(null);
    if (focusCode) {
      requestAnimationFrame(() => {
        const code = document.querySelector<HTMLInputElement>(
          '[data-recovery-entry] input[placeholder="Code"]',
        );
        focusField(code);
      });
    }
  }

  function addLine() {
    setError(null);
    const amt = Number(amount);
    if (!partyId || !party || !(amt > 0)) {
      setError("Select party and enter a recovery amount.");
      return false;
    }
    setLines((prev) => [
      ...prev,
      {
        key: newKey(),
        partyId,
        partyCode: party.party_code,
        partyName: party.name_en,
        amount: amt,
        remarks: remarks.trim(),
      },
    ]);
    clearDraft(true);
    return true;
  }

  function onAmountEnter(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    if (!partyId || !(Number(amount) > 0)) {
      focusField(remarksRef.current);
      return;
    }
    // Prefer remarks next if empty; otherwise add the line
    if (!remarks.trim()) {
      focusField(remarksRef.current);
      return;
    }
    addLine();
  }

  function onRemarksEnter(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    addLine();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Auto-add pending draft if valid
    let pending = lines;
    const amt = Number(amount);
    if (partyId && party && amt > 0) {
      const next: RecoveryLine = {
        key: newKey(),
        partyId,
        partyCode: party.party_code,
        partyName: party.name_en,
        amount: amt,
        remarks: remarks.trim(),
      };
      pending = [...lines, next];
      setLines(pending);
      clearDraft(false);
    }

    if (pending.length === 0) {
      setError("Add at least one recovery line before recording.");
      return;
    }
    if (salesmen.length > 0 && !salesmanId) {
      setError("Select the salesman who collected this recovery.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const failedKeys = new Set<string>();
    const failedMsgs: string[] = [];

    for (const line of pending) {
      const lineParty = parties.find((p) => p.id === line.partyId);
      const { error: rpcError } = await supabase.rpc("record_recovery", {
        p_payload: {
          organization_id: organizationId,
          company_id: companyId,
          party_id: line.partyId,
          recovery_date: date,
          amount: line.amount,
          remarks: line.remarks,
          salesman_id: salesmanId || null,
          route: lineParty?.route || null,
          city: lineParty?.city || null,
        },
      });
      if (rpcError) {
        failedKeys.add(line.key);
        failedMsgs.push(
          `${line.partyCode} — ${line.partyName}: ${rpcError.message}`,
        );
      }
    }

    setLoading(false);

    if (failedKeys.size) {
      setError(
        failedKeys.size === pending.length
          ? failedMsgs.join("\n")
          : `Saved ${pending.length - failedKeys.size} of ${pending.length}. Failed:\n${failedMsgs.join("\n")}`,
      );
      setLines(pending.filter((l) => failedKeys.has(l.key)));
      if (failedKeys.size < pending.length) router.refresh();
      return;
    }

    setLines([]);
    clearDraft(false);
    onDone?.();
    closeDialog?.();
    router.refresh();
  }

  const total = lines.reduce((s, l) => s + l.amount, 0);
  const draftAmt = Number(amount) > 0 ? Number(amount) : 0;
  const pendingCount = lines.length + (draftAmt > 0 && partyId ? 1 : 0);
  const grand = total + (draftAmt > 0 && partyId ? draftAmt : 0);

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Date</Label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-1">
          <SalesmanSelect
            salesmen={salesmen}
            value={salesmanId}
            onChange={setSalesmanId}
            required={salesmen.length > 0}
          />
        </div>
      </div>

      <div className="rounded-xl border border-[var(--brand)]/30 bg-[var(--brand-soft)]/40 px-3 py-2 text-xs text-[var(--brand-strong)]">
        Keyboard: party{" "}
        <kbd className="rounded bg-white px-1">code</kbd> →{" "}
        <kbd className="rounded bg-white px-1">Enter</kbd> → amount → remarks →{" "}
        <kbd className="rounded bg-white px-1">Enter</kbd> adds the line. Then
        record all at once.
      </div>

      <div
        data-recovery-entry
        className="grid min-w-0 gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/40 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_8rem_minmax(0,1fr)_auto]"
      >
        <div className="min-w-0 sm:col-span-2 lg:col-span-1">
          <PartyCodePicker
            companyId={companyId}
            parties={parties}
            value={partyId}
            label="Shop / party code"
            filterSubtype={["customer", "both"]}
            onChange={(id, next) => {
              setPartyId(id);
              setParty(next);
            }}
          />
          {partyId && balance != null ? (
            <p className="mt-1 text-xs text-[var(--muted)]">
              Balance:{" "}
              <span className="font-medium text-[var(--ink)]">
                {formatPkr(Math.abs(balance))}{" "}
                {balance > 0.005 ? "Dr" : balance < -0.005 ? "Cr" : "Nil"}
              </span>
            </p>
          ) : null}
        </div>
        <div className="min-w-0">
          <Label htmlFor={amountId}>Amount</Label>
          <Input
            ref={amountRef}
            id={amountId}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={onAmountEnter}
            placeholder="0.00"
          />
        </div>
        <div className="min-w-0">
          <Label htmlFor={remarksId}>Remarks</Label>
          <Input
            ref={remarksRef}
            id={remarksId}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            onKeyDown={onRemarksEnter}
            placeholder="Next / collected note"
          />
        </div>
        <div className="flex items-end">
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() => addLine()}
            data-enter-skip
          >
            Add line
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-[var(--surface-2)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2 font-semibold">Code</th>
                <th className="px-3 py-2 font-semibold">Party</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
                <th className="px-3 py-2 font-semibold">Remarks</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-[var(--muted)]"
                  >
                    No recoveries added yet — add lines above, then record.
                  </td>
                </tr>
              ) : (
                lines.map((line) => (
                  <tr
                    key={line.key}
                    className="border-t border-[var(--border)]"
                  >
                    <td className="px-3 py-2 font-medium tabular-nums">
                      {line.partyCode}
                    </td>
                    <td className="max-w-[14rem] truncate px-3 py-2">
                      {line.partyName}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-700">
                      {formatPkr(line.amount)}
                    </td>
                    <td className="max-w-[12rem] truncate px-3 py-2 text-[var(--muted)]">
                      {line.remarks || "—"}
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-rose-50 hover:text-rose-700"
                        aria-label="Remove line"
                        data-enter-skip
                        onClick={() =>
                          setLines((prev) =>
                            prev.filter((l) => l.key !== line.key),
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm">
          <span className="text-[var(--muted)]">
            {lines.length} line{lines.length === 1 ? "" : "s"}
            {draftAmt > 0 && partyId ? " (+ draft)" : ""}
          </span>
          <span className="font-semibold">
            Total {formatPkr(grand)}
          </span>
        </div>
      </div>

      {error ? (
        <p className="whitespace-pre-wrap rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={loading} className="w-full sm:w-auto">
        {loading
          ? "Recording..."
          : pendingCount > 0
            ? `Record ${pendingCount} recover${pendingCount === 1 ? "y" : "ies"}`
            : "Record recoveries"}
      </Button>
    </form>
  );
}

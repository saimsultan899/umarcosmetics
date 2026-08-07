"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { enqueueMutation } from "@/lib/offline/db";
import { createClient } from "@/lib/supabase/client";
import { FormEvent, useState } from "react";

type Shop = {
  party_id: string;
  party_code: string;
  name_en: string;
  balance: number;
};

export function FieldRecoveryForm({
  companyId,
  organizationId,
  shops,
}: {
  companyId: string;
  organizationId: string;
  shops: Shop[];
}) {
  const { online, refreshPending, runSync } = useSyncStatus();
  const [partyId, setPartyId] = useState(shops[0]?.party_id || "");
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!partyId || Number(amount) <= 0) {
      setError("Select shop and enter amount.");
      return;
    }

    const payload = {
      organization_id: organizationId,
      company_id: companyId,
      party_id: partyId,
      recovery_date: new Date().toISOString().slice(0, 10),
      amount: Number(amount),
      remarks,
    };

    setLoading(true);
    try {
      if (!online) {
        await enqueueMutation({
          companyId,
          type: "recovery",
          payload,
        });
        await refreshPending();
        setMessage("Saved offline. Will sync when internet is available.");
      } else {
        const supabase = createClient();
        const { error: rpcError } = await supabase.rpc("record_recovery", {
          p_payload: payload,
        });
        if (rpcError) throw new Error(rpcError.message);
        setMessage("Recovery posted to main dashboard.");
        await runSync();
      }
      setAmount("");
      setRemarks("");
    } catch (err) {
      // If online post fails, queue offline as fallback
      if (online) {
        await enqueueMutation({ companyId, type: "recovery", payload });
        await refreshPending();
        setMessage("Network issue — saved offline for later sync.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    } finally {
      setLoading(false);
    }
  }

  const selected = shops.find((s) => s.party_id === partyId);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label>Shop code</Label>
        <div className="grid grid-cols-[6rem_1fr] gap-2">
          <Input
            defaultValue={selected?.party_code || ""}
            key={partyId}
            placeholder="Code"
            onBlur={(e) => {
              const hit = shops.find(
                (s) =>
                  s.party_code.toLowerCase() === e.target.value.trim().toLowerCase(),
              );
              if (hit) setPartyId(hit.party_id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const value = (e.target as HTMLInputElement).value.trim();
                const hit = shops.find(
                  (s) => s.party_code.toLowerCase() === value.toLowerCase(),
                );
                if (hit) setPartyId(hit.party_id);
              }
            }}
          />
          <Select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
            {shops.map((s) => (
              <option key={s.party_id} value={s.party_id}>
                {s.party_code} — {s.name_en}
              </option>
            ))}
          </Select>
        </div>
        {selected ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            {selected.name_en} · Balance: {Number(selected.balance).toLocaleString()}{" "}
            {Number(selected.balance) > 0
              ? "Dr"
              : Number(selected.balance) < 0
                ? "Cr"
                : "Nil"}
          </p>
        ) : null}
      </div>
      <div>
        <Label>Recovery amount</Label>
        <Input
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          inputMode="decimal"
        />
      </div>
      <div>
        <Label>Remarks</Label>
        <Input
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Next / partial / note"
        />
      </div>
      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}
      {message ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>
      ) : null}
      <Button type="submit" className="w-full" disabled={loading || shops.length === 0}>
        {loading ? "Saving..." : online ? "Save recovery" : "Save offline"}
      </Button>
    </form>
  );
}

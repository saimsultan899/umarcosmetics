"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { offlineAwareSubmit } from "@/lib/offline/offline-submit";
import { createClient } from "@/lib/supabase/client";
import { AMOUNT_PLACEHOLDER, AMOUNT_STEP, formatNumber, formatPkr } from "@/lib/utils";
import {
  findSameDayRecoveries,
  formatRecoveryWhen,
  type SameDayRecovery,
} from "@/lib/vouchers/same-day-recovery";
import { FormEvent, useEffect, useRef, useState } from "react";

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
  const [todayRecoveries, setTodayRecoveries] = useState<SameDayRecovery[]>([]);
  const savingRef = useRef(false);
  const requestRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const date = new Date().toISOString().slice(0, 10);
    if (!partyId) {
      setTodayRecoveries([]);
      return;
    }
    void findSameDayRecoveries(companyId, partyId, date).then((rows) => {
      if (!cancelled) setTodayRecoveries(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, partyId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
    if (!partyId || Number(amount) <= 0) {
      setError("Select shop and enter amount.");
      return;
    }

    const date = new Date().toISOString().slice(0, 10);
    const prior = await findSameDayRecoveries(companyId, partyId, date);
    setTodayRecoveries(prior);
    const owed = selected?.balance ?? null;
    const shopName = selected?.name_en || "This customer";
    if (owed != null && owed <= 0.005) {
      setError(`${shopName} has no amount due. The recovery was not added.`);
      return;
    }
    if (owed != null && Number(amount) > owed + 0.005) {
      setError(
        `${shopName} still owes ${formatPkr(owed)}. A higher recovery was not added.`,
      );
      return;
    }
    let confirmed = false;
    if (prior.length > 0) {
      const listed = prior
        .map((row) => {
          const when = formatRecoveryWhen(row.at);
          return when ? `${formatPkr(row.amount)} at ${when}` : formatPkr(row.amount);
        })
        .join(", ");
      const proceed = window.confirm(
        `${shopName} already has a recovery today${listed ? `: ${listed}` : ""}.\n\nRecord this recovery anyway?`,
      );
      if (!proceed) return;
      confirmed = true;
    }

    if (!requestRef.current) requestRef.current = crypto.randomUUID();
    const payload = {
      organization_id: organizationId,
      company_id: companyId,
      party_id: partyId,
      recovery_date: date,
      amount: Number(amount),
      remarks,
      client_request_id: requestRef.current,
      confirm_duplicate: confirmed,
    };

    try {
      const res = await offlineAwareSubmit({
        mutationType: "recovery",
        companyId,
        organizationId,
        payload,
      });

      await refreshPending();
      if (res.source === "offline") {
        setMessage("Saved offline. Will sync when internet is available.");
      } else {
        setMessage("Recovery posted to main dashboard.");
        await runSync();
      }
      setAmount("");
      setRemarks("");
      requestRef.current = null;
    } catch (err: any) {
      setError(err?.message || String(err));
    }
    } finally {
      savingRef.current = false;
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
            {selected.name_en} · Balance: {formatNumber(selected.balance)}{" "}
            {Number(selected.balance) > 0
              ? "Dr"
              : Number(selected.balance) < 0
                ? "Cr"
                : "Nil"}
          </p>
        ) : null}
        {selected && Number(selected.balance) <= 0.005 ? (
          <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
            No amount due. A recovery cannot be added for this customer.
          </p>
        ) : null}
        {todayRecoveries.length > 0 ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
            Already collected today:{" "}
            {todayRecoveries
              .map((row) => {
                const when = formatRecoveryWhen(row.at);
                return when ? `${formatPkr(row.amount)} at ${when}` : formatPkr(row.amount);
              })
              .join(", ")}
          </p>
        ) : null}
      </div>
      <div>
        <Label>Recovery amount</Label>
        <Input
          type="number"
          min="0"
          step={AMOUNT_STEP}
          placeholder={AMOUNT_PLACEHOLDER}
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
      <Button type="submit" className="w-full" loading={loading} disabled={shops.length === 0}>
        {loading ? "Saving..." : online ? "Save recovery" : "Save offline"}
      </Button>
    </form>
  );
}

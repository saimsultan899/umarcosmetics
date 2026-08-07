"use client";

import { PartyCodePicker } from "@/components/forms/party-code-picker";
import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import type { Party } from "@/lib/types/database";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function RecoveryForm({
  companyId,
  organizationId,
  parties,
  onDone,
}: {
  companyId: string;
  organizationId: string;
  parties: Party[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  const [partyId, setPartyId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [remarks, setRemarks] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    if (!partyId || Number(amount) <= 0) {
      setError("Select party and enter recovery amount.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("record_recovery", {
      p_payload: {
        organization_id: organizationId,
        company_id: companyId,
        party_id: partyId,
        recovery_date: date,
        amount: Number(amount),
        remarks,
      },
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setOk("Recovery saved and cash receipt posted.");
    setAmount("");
    setRemarks("");
    onDone?.();
    closeDialog?.();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <Label>Date</Label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="sm:col-span-2 lg:col-span-2">
        <PartyCodePicker
          companyId={companyId}
          parties={parties}
          value={partyId}
          required
          label="Shop / party code"
          filterSubtype={["customer", "both"]}
          onChange={(id) => setPartyId(id)}
        />
      </div>
      <div>
        <Label>Amount</Label>
        <Input
          type="number"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <Label>Remarks</Label>
        <Input
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Next / collected note"
        />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Saving..." : "Record recovery"}
        </Button>
      </div>
      {error ? (
        <p className="sm:col-span-2 lg:col-span-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="sm:col-span-2 lg:col-span-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {ok}
        </p>
      ) : null}
    </form>
  );
}

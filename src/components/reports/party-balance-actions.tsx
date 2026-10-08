"use client";

import { PartyForm } from "@/components/forms/party-form";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { offlineAwareSubmit } from "@/lib/offline/offline-submit";
import { createClient } from "@/lib/supabase/client";
import type { Party } from "@/lib/types/database";
import { useEffect, useState } from "react";

function PartyEditForm({
  partyId,
  companyId,
  organizationId,
  onDone,
}: {
  partyId: string;
  companyId: string;
  organizationId: string;
  onDone: () => void;
}) {
  const [party, setParty] = useState<Party | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from("parties")
      .select("*")
      .eq("id", partyId)
      .single()
      .then(({ data, error: loadError }) => {
        if (loadError || !data) {
          setError(loadError?.message || "Customer not found");
          return;
        }
        setParty(data as Party);
      });
  }, [partyId]);

  if (error) {
    return <p className="text-sm text-rose-700">{error}</p>;
  }
  if (!party) {
    return <p className="text-sm text-[var(--muted)]">Loading customer…</p>;
  }
  return (
    <PartyForm
      companyId={companyId}
      organizationId={organizationId}
      initial={party}
      onDone={onDone}
    />
  );
}

export function PartyBalanceActions({
  partyId,
  companyId,
  organizationId,
  partyLabel,
  fields,
  canEdit,
  canInactivate,
}: {
  partyId: string;
  companyId: string;
  organizationId: string;
  partyLabel: string;
  fields: DetailField[];
  canEdit: boolean;
  canInactivate: boolean;
}) {
  async function inactivate() {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("parties")
      .select("*")
      .eq("id", partyId)
      .single();
    if (error || !data) throw new Error(error?.message || "Customer not found");
    const payload = { ...(data as Party), is_active: false };
    await offlineAwareSubmit({
      mutationType: "party_update",
      companyId,
      organizationId,
      cacheStore: "parties",
      cacheRecord: payload,
      payload,
    });
  }

  return (
    <RowActions
      viewTitle={partyLabel}
      viewFields={fields}
      editTitle={`Update ${partyLabel}`}
      allowEdit={canEdit}
      editContent={
        canEdit
          ? (close) => (
              <PartyEditForm
                partyId={partyId}
                companyId={companyId}
                organizationId={organizationId}
                onDone={close}
              />
            )
          : undefined
      }
      allowDelete={canInactivate}
      deleteTitle={`Hide ${partyLabel}?`}
      deleteDescription="The customer is hidden from new bills. Old invoices and the balance stay on the books. This does not delete the account."
      deleteConfirmLabel="Hide customer"
      onDelete={canInactivate ? inactivate : undefined}
    />
  );
}

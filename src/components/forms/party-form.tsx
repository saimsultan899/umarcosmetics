"use client";

import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import {
  PARTY_CITIES,
  PARTY_SECTORS,
  withCurrentOption,
} from "@/lib/locations";
import { createClient } from "@/lib/supabase/client";
import type { Party, PartySubtype, PartyType, SaleChannel } from "@/lib/types/database";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

type PartyFormState = {
  party_code: string;
  name_en: string;
  name_ur: string;
  party_type: PartyType;
  party_subtype: PartySubtype;
  city: string;
  route: string;
  address: string;
  mobile: string;
  phone: string;
  contact_person: string;
  ntn: string;
  opening_balance: string;
  credit_limit: string;
  sale_channel: SaleChannel;
};

export function PartyForm({
  companyId,
  organizationId,
  initial,
  onDone,
}: {
  companyId: string;
  organizationId: string;
  initial?: Party | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoCode, setAutoCode] = useState(!initial);
  const [form, setForm] = useState<PartyFormState>({
    party_code: initial?.party_code || "",
    name_en: initial?.name_en || "",
    name_ur: initial?.name_ur || "",
    party_type: initial?.party_type || "PARTY",
    party_subtype: initial?.party_subtype || "customer",
    city: initial?.city || "",
    route: initial?.route || "",
    address: initial?.address || "",
    mobile: initial?.mobile || "",
    phone: initial?.phone || "",
    contact_person: initial?.contact_person || "",
    ntn: initial?.ntn || "",
    opening_balance: String(initial?.opening_balance ?? 0),
    credit_limit: String(initial?.credit_limit ?? 0),
    sale_channel: initial?.sale_channel || "retail",
  });

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc("peek_next_party_code", {
        p_company_id: companyId,
      });
      if (!cancelled && data) {
        setForm((f) => ({ ...f, party_code: String(data) }));
        setAutoCode(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, initial]);

  function set<K extends keyof PartyFormState>(key: K, value: PartyFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const cityOptions = useMemo(
    () => withCurrentOption(PARTY_CITIES, form.city),
    [form.city],
  );
  const sectorOptions = useMemo(
    () => withCurrentOption(PARTY_SECTORS, form.route),
    [form.route],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();

    let partyCode = form.party_code.trim();
    if (!initial && autoCode) {
      const { data: allocated, error: allocError } = await supabase.rpc(
        "next_party_code",
        { p_company_id: companyId },
      );
      if (allocError) {
        setLoading(false);
        setError(allocError.message);
        return;
      }
      partyCode = String(allocated);
      setForm((f) => ({ ...f, party_code: partyCode }));
    }

    if (!partyCode) {
      setLoading(false);
      setError("Party code is required.");
      return;
    }

    const payload = {
      organization_id: organizationId,
      company_id: companyId,
      party_code: partyCode,
      name_en: form.name_en.trim(),
      name_ur: form.name_ur.trim() || null,
      party_type: form.party_type,
      party_subtype: form.party_subtype,
      city: form.city.trim() || null,
      route: form.route.trim() || null,
      address: form.address.trim() || null,
      mobile: form.mobile.trim() || null,
      phone: form.phone.trim() || null,
      contact_person: form.contact_person.trim() || null,
      ntn: form.ntn.trim() || null,
      opening_balance: Number(form.opening_balance || 0),
      credit_limit: Number(form.credit_limit || 0),
      sale_channel: form.sale_channel,
    };

    const query = initial
      ? supabase.from("parties").update(payload).eq("id", initial.id)
      : supabase.from("parties").insert(payload);

    const { error: saveError } = await query;
    setLoading(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    onDone?.();
    closeDialog?.();
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 sm:grid-cols-2"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >      <div>
        <Label>Party code (auto serial)</Label>
        <Input
          value={form.party_code}
          onChange={(e) => {
            setAutoCode(false);
            set("party_code", e.target.value);
          }}
          required
          readOnly={!!initial}
          className={initial ? "bg-[var(--surface-2)]" : undefined}
        />
        {!initial ? (
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            {autoCode
              ? "Next serial reserved on save. Edit to override manually."
              : "Manual code — serial auto mode off for this entry."}
          </p>
        ) : null}
      </div>
      <div>
        <Label>Party name</Label>
        <Input value={form.name_en} onChange={(e) => set("name_en", e.target.value)} required />
      </div>
      <div>
        <Label>Urdu name</Label>
        <Input value={form.name_ur} onChange={(e) => set("name_ur", e.target.value)} dir="rtl" />
      </div>
      <div>
        <Label>Type</Label>
        <Select
          value={form.party_type}
          onChange={(e) => set("party_type", e.target.value as PartyType)}
        >
          {(["PARTY", "ASSETS", "CAPITAL", "EXPENSES", "INCOME"] as PartyType[]).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label>Subtype</Label>
        <Select
          value={form.party_subtype}
          onChange={(e) => set("party_subtype", e.target.value as PartySubtype)}
        >
          <option value="customer">Customer / Shop</option>
          <option value="supplier">Supplier</option>
          <option value="both">Both</option>
          <option value="other">Other</option>
        </Select>
      </div>
      <div>
        <Label>Sale channel</Label>
        <Select
          value={form.sale_channel}
          onChange={(e) => set("sale_channel", e.target.value as SaleChannel)}
        >
          <option value="retail">Retail</option>
          <option value="wholesale">Wholesale</option>
        </Select>
      </div>
      <div>
        <Label>City / Head</Label>
        <Select
          value={form.city}
          onChange={(e) => set("city", e.target.value)}
          placeholder="Select city"
        >
          <option value="">Select city</option>
          {cityOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>Sector</Label>
        <Select
          value={form.route}
          onChange={(e) => set("route", e.target.value)}
          placeholder="Select sector"
        >
          <option value="">Select sector</option>
          {sectorOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>
      <div className="sm:col-span-2">
        <Label>Address</Label>
        <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
      </div>
      <div>
        <Label>Mobile</Label>
        <Input value={form.mobile} onChange={(e) => set("mobile", e.target.value)} />
      </div>
      <div>
        <Label>Phone</Label>
        <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
      </div>
      <div>
        <Label>Contact person</Label>
        <Input value={form.contact_person} onChange={(e) => set("contact_person", e.target.value)} />
      </div>
      <div>
        <Label>NTN</Label>
        <Input value={form.ntn} onChange={(e) => set("ntn", e.target.value)} />
      </div>
      <div>
        <Label>Opening balance</Label>
        <Input
          type="number"
          step="0.01"
          value={form.opening_balance}
          onChange={(e) => set("opening_balance", e.target.value)}
        />
      </div>
      <div>
        <Label>Credit limit</Label>
        <Input
          type="number"
          step="0.01"
          value={form.credit_limit}
          onChange={(e) => set("credit_limit", e.target.value)}
        />
      </div>

      {error ? (
        <p className="sm:col-span-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <Button type="submit" disabled={loading}>
          {loading ? "Saving..." : initial ? "Update party" : "Save party"}
        </Button>
      </div>
    </form>
  );
}

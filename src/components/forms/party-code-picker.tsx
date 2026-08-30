"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  focusField,
  getFocusableFields,
} from "@/lib/keyboard/enter-nav";
import { createClient } from "@/lib/supabase/client";
import type { Party } from "@/lib/types/database";
import { useEffect, useMemo, useRef, useState } from "react";

function focusAfterParty(codeEl: HTMLElement) {
  const root =
    codeEl.closest<HTMLElement>("[data-enter-root]") ||
    codeEl.closest("form") ||
    document.body;
  const fields = getFocusableFields(root);
  const idx = fields.indexOf(codeEl);
  // Skip code + party select → land on next header field (warehouse, etc.)
  const target = fields[idx + 2] || fields[idx + 1];
  focusField(target);
}

export function PartyCodePicker({
  companyId,
  parties,
  value,
  onChange,
  label = "Party code / shop",
  required,
  filterSubtype,
}: {
  companyId: string;
  parties: Party[];
  value: string;
  onChange: (partyId: string, party: Party | null) => void;
  label?: string;
  required?: boolean;
  filterSubtype?: Array<Party["party_subtype"]>;
}) {
  const options = useMemo(() => {
    let list = parties.filter((p) => p.is_active !== false);
    if (filterSubtype?.length) {
      list = list.filter((p) => filterSubtype.includes(p.party_subtype));
    }
    return list;
  }, [parties, filterSubtype]);

  const selected = options.find((p) => p.id === value) || null;
  const [code, setCode] = useState(selected?.party_code || "");
  const [status, setStatus] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCode(selected?.party_code || "");
  }, [selected?.id, selected?.party_code]);

  async function resolveCode(raw: string, moveNext = false) {
    const trimmed = raw.trim();
    if (!trimmed) {
      onChange("", null);
      setStatus(null);
      return;
    }

    const local = options.find(
      (p) => p.party_code.toLowerCase() === trimmed.toLowerCase(),
    );
    if (local) {
      onChange(local.id, local);
      setCode(local.party_code);
      setStatus(null);
      if (moveNext && codeRef.current) focusAfterParty(codeRef.current);
      return;
    }

    setLooking(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_party_by_code", {
      p_company_id: companyId,
      p_code: trimmed,
    });
    setLooking(false);

    const party = Array.isArray(data) ? data[0] : data;
    if (error || !party) {
      onChange("", null);
      setStatus("No party found for this code");
      return;
    }

    if (
      filterSubtype?.length &&
      !filterSubtype.includes(party.party_subtype as Party["party_subtype"])
    ) {
      onChange("", null);
      setStatus("Party found but not allowed for this document");
      return;
    }

    onChange(party.id, party as Party);
    setCode(party.party_code);
    setStatus(null);
    if (moveNext && codeRef.current) focusAfterParty(codeRef.current);
  }

  return (
    <div className="min-w-0 space-y-2">
      <Label>{label}</Label>
      <div className="grid min-w-0 gap-2 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
        <Input
          ref={codeRef}
          value={code}
          placeholder="Code"
          inputMode="numeric"
          required={required && !value}
          onChange={(e) => {
            setCode(e.target.value);
            setStatus(null);
          }}
          onBlur={() => void resolveCode(code)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              void resolveCode(code, true);
            }
          }}
        />
        <Select
          value={value}
          required={required}
          className="min-w-0"
          onChange={(e) => {
            const party = options.find((p) => p.id === e.target.value) || null;
            onChange(e.target.value, party);
            setCode(party?.party_code || "");
            setStatus(null);
          }}
        >
          <option value="">Select party</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.party_code} — {p.name_en}
            </option>
          ))}
        </Select>
      </div>

      {selected ? (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs">
          <p className="truncate font-medium text-[var(--ink)]">
            {selected.party_code} — {selected.name_en}
          </p>
          <p className="mt-0.5 truncate text-[var(--muted)]">
            {[selected.city, selected.route, selected.mobile || selected.phone]
              .filter(Boolean)
              .join(" · ") || "No contact/sector details"}
            {Number(selected.credit_limit) > 0
              ? ` · Credit limit ${Number(selected.credit_limit).toLocaleString()}`
              : ""}
          </p>
        </div>
      ) : looking ? (
        <p className="text-xs text-[var(--muted)]">Looking up party...</p>
      ) : status ? (
        <p className="text-xs text-rose-700">{status}</p>
      ) : (
        <p className="text-xs text-[var(--muted)]">
          Type party number and press Enter to fetch details
        </p>
      )}
    </div>
  );
}

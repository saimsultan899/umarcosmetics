"use client";

import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { Party } from "@/lib/types/database";
import { useEffect, useMemo, useState } from "react";

/** Compact code + select for voucher/journal table rows */
export function PartyCodeCell({
  companyId,
  parties,
  value,
  onChange,
}: {
  companyId: string;
  parties: Party[];
  value: string;
  onChange: (partyId: string) => void;
}) {
  const selected = parties.find((p) => p.id === value) || null;
  const [code, setCode] = useState(selected?.party_code || "");

  const options = useMemo(
    () => [
      { value: "", label: "Select account" },
      ...parties.map((p) => ({
        value: p.id,
        label: `${p.party_code} — ${p.name_en}`,
      })),
    ],
    [parties],
  );

  useEffect(() => {
    setCode(selected?.party_code || "");
  }, [selected?.id, selected?.party_code]);

  async function resolve(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      onChange("");
      return;
    }
    const local = parties.find(
      (p) => p.party_code.toLowerCase() === trimmed.toLowerCase(),
    );
    if (local) {
      onChange(local.id);
      setCode(local.party_code);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase.rpc("get_party_by_code", {
      p_company_id: companyId,
      p_code: trimmed,
    });
    const party = Array.isArray(data) ? data[0] : data;
    if (party) {
      onChange(party.id);
      setCode(party.party_code);
    }
  }

  return (
    <div className="flex gap-1.5">
      <input
        className="h-9 w-20 shrink-0 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
        value={code}
        placeholder="Code"
        onChange={(e) => setCode(e.target.value)}
        onBlur={() => void resolve(code)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void resolve(code);
          }
        }}
      />
      <Select
        size="sm"
        className="min-w-0 flex-1"
        value={value}
        options={options}
        onChange={(e) => {
          onChange(e.target.value);
          const p = parties.find((x) => x.id === e.target.value);
          setCode(p?.party_code || "");
        }}
      />
    </div>
  );
}

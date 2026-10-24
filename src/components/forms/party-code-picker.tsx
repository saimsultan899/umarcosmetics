"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  focusField,
  getFocusableFields,
} from "@/lib/keyboard/enter-nav";
import { escapeIlike } from "@/lib/pagination";
import { getCachedRows } from "@/lib/offline/local-db";
import { createClient } from "@/lib/supabase/client";
import type { Party } from "@/lib/types/database";
import { useEffect, useMemo, useRef, useState } from "react";

async function findLocalPartyByCode(companyId: string, code: string) {
  const want = code.trim().toLowerCase();
  if (!want) return null;
  const local: Array<Record<string, unknown>> = [];
  try {
    const { hasLocalSqlite, localListMaster } = await import(
      "@/lib/offline/sqlite-client"
    );
    if (hasLocalSqlite()) {
      const res = await localListMaster("parties", companyId, 10000);
      if (res.rows?.length) local.push(...res.rows);
    }
  } catch {
    // Desktop list is optional.
  }
  try {
    const cached = await getCachedRows("parties", companyId);
    if (cached.length) local.push(...cached);
  } catch {
    // IndexedDB is optional.
  }
  const row = local.find(
    (item) =>
      String(item.party_code || item.code || "").trim().toLowerCase() === want,
  );
  return (row as Party | undefined) || null;
}

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
  label = "Customer code / shop",
  emptyLabel = "Select customer",
  required,
  filterSubtype,
  compact = false,
  onPartySelected,
  confineToList = false,
  confineRoute = "",
  confineCity = "",
  maxVisible,
}: {
  companyId: string;
  parties: Party[];
  value: string;
  onChange: (partyId: string, party: Party | null) => void;
  label?: string;
  emptyLabel?: string;
  required?: boolean;
  filterSubtype?: Array<Party["party_subtype"]>;
  /** Table-row mode: code + select only, no label or detail card. */
  compact?: boolean;
  onPartySelected?: () => void;
  /** When a city or sector filter is on, do not accept a code outside that list. */
  confineToList?: boolean;
  /** Remote search must stay inside this sector (route). */
  confineRoute?: string;
  /** Remote search must stay inside this city. */
  confineCity?: string;
  /** Show the full list instead of the default short window. */
  maxVisible?: number;
}) {
  const [found, setFound] = useState<Party[]>([]);
  const searchGen = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const routeKey = confineRoute.trim().toLowerCase();
  const cityKey = confineCity.trim().toLowerCase();

  const options = useMemo(() => {
    function matchesConfine(party: Party) {
      if (routeKey && (party.route || "").trim().toLowerCase() !== routeKey) {
        return false;
      }
      if (cityKey && (party.city || "").trim().toLowerCase() !== cityKey) {
        return false;
      }
      return true;
    }
    const allowedIds = new Set(
      parties.filter((p) => p?.id).map((p) => p.id),
    );
    const byId = new Map<string, Party>();
    for (const party of parties) {
      if (party?.id) byId.set(party.id, party);
    }
    // Remote search can find shops outside the sector/city list — keep them
    // out when the caller has confined the picker. Prefer route/city match so
    // shops beyond the first API page still appear for that sector.
    for (const party of found) {
      if (!party?.id) continue;
      if (confineToList) {
        if (routeKey || cityKey) {
          if (!matchesConfine(party)) continue;
        } else if (!allowedIds.has(party.id)) {
          continue;
        }
      }
      byId.set(party.id, party);
    }
    let list = [...byId.values()].filter((p) => p.is_active !== false);
    if (filterSubtype?.length) {
      list = list.filter((p) => filterSubtype.includes(p.party_subtype));
    }
    if (confineToList && (routeKey || cityKey)) {
      list = list.filter((p) => matchesConfine(p));
    }
    list.sort((a, b) => {
      const ao = Number(a.sort_order ?? 0);
      const bo = Number(b.sort_order ?? 0);
      if (ao !== bo) return ao - bo;
      return String(a.party_code || "").localeCompare(String(b.party_code || ""));
    });
    return list;
  }, [parties, found, filterSubtype, confineToList, routeKey, cityKey]);

  function onSearch(raw: string) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = raw.trim();
    if (q.length < 2) {
      searchGen.current += 1;
      setFound([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      void searchParties(q);
    }, 200);
  }

  async function searchParties(raw: string) {
    const gen = ++searchGen.current;
    const term = escapeIlike(raw).toLowerCase();
    if (!term) return;

    // Search the catalog already on the form first. Exact code entry still
    // calls get_party_by_code when the shop is not in this list.
    if (parties.length) {
      const known = parties
        .filter((party) => {
          if (!party?.id || party.is_active === false) return false;
          const code = String(party.party_code || "").toLowerCase();
          const name = String(party.name_en || "").toLowerCase();
          return code.includes(term) || name.includes(term);
        })
        .slice(0, 80);
      if (known.length) {
        if (gen === searchGen.current) setFound(known);
        return;
      }
    }

    const rows: Party[] = [];
    try {
      if (typeof navigator === "undefined" || navigator.onLine) {
        const pattern = `%${term}%`;
        const supabase = createClient();
        let query = supabase
          .from("parties")
          .select("*")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .or(`party_code.ilike."${pattern}",name_en.ilike."${pattern}"`);
        if (confineRoute.trim()) query = query.eq("route", confineRoute.trim());
        if (confineCity.trim()) query = query.eq("city", confineCity.trim());
        const { data, error } = await query.order("name_en").limit(80);
        if (!error && data) rows.push(...(data as Party[]));
      }
    } catch {
      // Keep going and also check the saved customer list.
    }
    {
      const local: Array<Record<string, unknown>> = [];
      try {
        const { hasLocalSqlite, localListMaster } = await import(
          "@/lib/offline/sqlite-client"
        );
        if (hasLocalSqlite()) {
          const res = await localListMaster("parties", companyId, 10000);
          if (res.rows?.length) local.push(...res.rows);
        }
      } catch {
        // Desktop list is optional.
      }
      try {
        const cached = await getCachedRows("parties", companyId);
        if (cached.length) local.push(...cached);
      } catch {
        // IndexedDB is optional.
      }
      for (const row of local) {
        const code = String(row.party_code || row.code || "").toLowerCase();
        const name = String(row.name_en || "").toLowerCase();
        if (!code.includes(term) && !name.includes(term)) continue;
        if (
          confineRoute.trim() &&
          String(row.route || "").trim().toLowerCase() !==
            confineRoute.trim().toLowerCase()
        ) {
          continue;
        }
        if (
          confineCity.trim() &&
          String(row.city || "").trim().toLowerCase() !==
            confineCity.trim().toLowerCase()
        ) {
          continue;
        }
        if (rows.some((existing) => existing.id === row.id)) continue;
        rows.push(row as Party);
        if (rows.length >= 80) break;
      }
    }
    if (gen !== searchGen.current) return;
    setFound(rows);
  }

  const selected = options.find((p) => p.id === value) || null;
  const [code, setCode] = useState(selected?.party_code || "");
  const [status, setStatus] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCode(selected?.party_code || "");
  }, [selected?.id, selected?.party_code]);

  function afterPartyPicked(moveNext: boolean) {
    if (!moveNext) return;
    if (onPartySelected) {
      onPartySelected();
      return;
    }
    if (codeRef.current) focusAfterParty(codeRef.current);
  }

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
      afterPartyPicked(moveNext);
      return;
    }

    setLooking(true);
    let party: any = null;
    try {
      const supabase = createClient();
      // When a sector/city filter is on, resolve inside that filter first so
      // shops past the company-wide 1000-row page are still found.
      if (confineRoute.trim() || confineCity.trim()) {
        let direct = supabase
          .from("parties")
          .select("*")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .ilike("party_code", trimmed)
          .limit(1);
        if (confineRoute.trim()) {
          direct = direct.eq("route", confineRoute.trim());
        }
        if (confineCity.trim()) {
          direct = direct.eq("city", confineCity.trim());
        }
        const { data: scoped, error: scopedErr } = await direct.maybeSingle();
        if (!scopedErr && scoped) party = scoped;
      }
      if (!party) {
        const { data, error } = await supabase.rpc("get_party_by_code", {
          p_company_id: companyId,
          p_code: trimmed,
        });
        if (!error && data) {
          party = Array.isArray(data) ? data[0] : data;
        }
      }
    } catch {
      // offline fallback
    }
    if (!party) {
      party = await findLocalPartyByCode(companyId, trimmed);
    }
    setLooking(false);

    if (!party) {
      onChange("", null);
      setStatus("No account found for this code");
      return;
    }

    if (confineToList) {
      const routeOk =
        !confineRoute.trim() ||
        String(party.route || "").trim().toLowerCase() ===
          confineRoute.trim().toLowerCase();
      const cityOk =
        !confineCity.trim() ||
        String(party.city || "").trim().toLowerCase() ===
          confineCity.trim().toLowerCase();
      // Trust the shop's own route/city from the server — do not require it to
      // already be in the truncated in-memory list.
      if ((confineRoute.trim() || confineCity.trim()) && !(routeOk && cityOk)) {
        onChange("", null);
        setStatus("This shop is not in the selected sector");
        return;
      }
      if (!confineRoute.trim() && !confineCity.trim()) {
        const inList = options.some((p) => p.id === party.id);
        if (!inList) {
          onChange("", null);
          setStatus("This shop is not in the selected sector");
          return;
        }
      }
    }

    if (
      filterSubtype?.length &&
      !filterSubtype.includes(party.party_subtype as Party["party_subtype"])
    ) {
      onChange("", null);
      setStatus("Account found but not allowed for this document");
      return;
    }

    onChange(party.id, party as Party);
    setCode(party.party_code);
    setStatus(null);
    afterPartyPicked(moveNext);
  }

  return (
    <div className="min-w-0 space-y-1">
      {!compact && label ? <Label>{label}</Label> : null}
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
          maxVisible={maxVisible}
          className="min-w-0"
          onSearch={onSearch}
          onChange={(e) => {
            const party = options.find((p) => p.id === e.target.value) || null;
            onChange(e.target.value, party);
            setCode(party?.party_code || "");
            setStatus(null);
            if (party) onPartySelected?.();
          }}
        >
          <option value="">{emptyLabel}</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.party_code} — {p.name_en}
            </option>
          ))}
        </Select>
      </div>

      {looking ? (
        <p className="text-[10px] text-[var(--muted)]">Looking up...</p>
      ) : status ? (
        <p className="text-[10px] text-rose-700">{status}</p>
      ) : null}
    </div>
  );
}

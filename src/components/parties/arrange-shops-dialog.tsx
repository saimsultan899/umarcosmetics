"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { putCachedRow } from "@/lib/offline/local-db";
import { hasLocalSqlite, localUpsertMaster } from "@/lib/offline/sqlite-client";
import { createClient } from "@/lib/supabase/client";
import type { Party } from "@/lib/types/database";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, GripVertical, ListOrdered, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Scope = "overall" | "city" | "sector";

type ShopRow = {
  id: string;
  party_code: string;
  name_en: string;
  city: string | null;
  head: string | null;
  route: string | null;
  sort_order: number;
};

function cityHead(p: Pick<ShopRow, "city" | "head">) {
  return (p.city || p.head || "").trim();
}

function moveItem<T>(list: T[], from: number, to: number) {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function scopeNeedsPick(scope: Scope, city: string, sector: string) {
  return (scope === "city" && !city) || (scope === "sector" && !sector);
}

/** Prefer exact code → code prefix → name prefix → any includes (code/name/city/sector). */
function findShopIndex(shops: ShopRow[], query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return -1;

  const hay = (s: ShopRow) =>
    [
      s.party_code,
      s.name_en,
      cityHead(s),
      s.route || "",
    ]
      .join(" ")
      .toLowerCase();

  const exactCode = shops.findIndex(
    (s) => s.party_code.trim().toLowerCase() === q,
  );
  if (exactCode >= 0) return exactCode;

  const codePrefix = shops.findIndex((s) =>
    s.party_code.trim().toLowerCase().startsWith(q),
  );
  if (codePrefix >= 0) return codePrefix;

  const namePrefix = shops.findIndex((s) =>
    s.name_en.trim().toLowerCase().startsWith(q),
  );
  if (namePrefix >= 0) return namePrefix;

  return shops.findIndex((s) => hay(s).includes(q));
}

export function ArrangeShopsButton({
  companyId,
  cityOptions = [],
  sectorOptions = [],
  onSaved,
}: {
  companyId: string;
  cityOptions?: string[];
  sectorOptions?: string[];
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <ListOrdered className="h-4 w-4" />
        Arrange shops
      </Button>
      <ArrangeShopsDialog
        open={open}
        onClose={() => setOpen(false)}
        companyId={companyId}
        cityOptions={cityOptions}
        sectorOptions={sectorOptions}
        onSaved={() => {
          setOpen(false);
          onSaved?.();
        }}
      />
    </>
  );
}

export function ArrangeShopsDialog({
  open,
  onClose,
  companyId,
  cityOptions = [],
  sectorOptions = [],
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  cityOptions?: string[];
  sectorOptions?: string[];
  onSaved?: () => void;
}) {
  const [scope, setScope] = useState<Scope>("overall");
  const [city, setCity] = useState("");
  const [sector, setSector] = useState("");
  const [allShops, setAllShops] = useState<ShopRow[]>([]);
  const [rows, setRows] = useState<ShopRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const loadShops = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: qError } = await supabase
        .from("parties")
        .select("id, party_code, name_en, city, head, route, sort_order, is_active, party_type, party_subtype")
        .eq("company_id", companyId)
        .eq("party_type", "PARTY")
        .in("party_subtype", ["customer", "both"])
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("party_code", { ascending: true })
        .limit(10000);
      if (qError) throw new Error(qError.message);
      const mapped = ((data || []) as Party[]).map((p) => ({
        id: p.id,
        party_code: p.party_code,
        name_en: p.name_en,
        city: p.city,
        head: p.head,
        route: p.route,
        sort_order: Number(p.sort_order ?? 0),
      }));
      setAllShops(mapped);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setAllShops([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (!open) return;
    setScope("overall");
    setCity("");
    setSector("");
    setSearch("");
    setHighlightId(null);
    setError(null);
    void loadShops();
  }, [open, loadShops]);

  const cityChoices = useMemo(() => {
    const fromShops = allShops.map((s) => cityHead(s)).filter(Boolean);
    return [...new Set([...cityOptions, ...fromShops])].sort((a, b) =>
      a.localeCompare(b),
    );
  }, [allShops, cityOptions]);

  const sectorChoices = useMemo(() => {
    const fromShops = allShops.map((s) => (s.route || "").trim()).filter(Boolean);
    return [...new Set([...sectorOptions, ...fromShops])].sort((a, b) =>
      a.localeCompare(b),
    );
  }, [allShops, sectorOptions]);

  useEffect(() => {
    if (!open) return;
    let next = allShops;
    if (scope === "city") {
      if (!city) {
        setRows([]);
        setHighlightId(null);
        return;
      }
      next = allShops.filter((s) => cityHead(s) === city);
    } else if (scope === "sector") {
      if (!sector) {
        setRows([]);
        setHighlightId(null);
        return;
      }
      next = allShops.filter((s) => (s.route || "").trim() === sector);
    }
    setRows(next);
  }, [allShops, scope, city, sector, open]);

  // Keep highlight on the best match for the current list (does not scroll).
  useEffect(() => {
    if (!open || loading || scopeNeedsPick(scope, city, sector)) {
      return;
    }
    const q = search.trim();
    if (!q) {
      setHighlightId(null);
      return;
    }
    const idx = findShopIndex(rows, q);
    setHighlightId(idx >= 0 ? rows[idx].id : null);
  }, [search, rows, open, loading, scope, city, sector]);

  // Scroll only when the search text (or matched shop) changes — not on drag reorder.
  useEffect(() => {
    if (!highlightId || !search.trim()) return;
    const frame = window.requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(
        `[data-shop-id="${highlightId}"]`,
      );
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [search, highlightId]);

  function move(index: number, dir: -1 | 1) {
    setRows((prev) => moveItem(prev, index, index + dir));
  }

  async function save() {
    if (!rows.length) {
      setError("No shops to arrange for this filter.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const partyIds = rows.map((r) => r.id);
      const { error: rpcError } = await supabase.rpc("reorder_shops", {
        p_payload: {
          company_id: companyId,
          party_ids: partyIds,
        },
      });
      if (rpcError) throw new Error(rpcError.message);

      // Refresh local cache order so offline lists match.
      const { data: refreshed } = await supabase
        .from("parties")
        .select("*")
        .eq("company_id", companyId)
        .in("id", partyIds);
      for (const row of refreshed || []) {
        const record = row as Record<string, unknown>;
        await putCachedRow("parties", companyId, record);
        if (hasLocalSqlite()) {
          await localUpsertMaster("parties", record);
        }
      }

      onSaved?.();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const needsPick = scopeNeedsPick(scope, city, sector);
  const searchMatchCount = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !rows.length) return 0;
    return rows.filter((s) => {
      const blob = [
        s.party_code,
        s.name_en,
        cityHead(s),
        s.route || "",
      ]
        .join(" ")
        .toLowerCase();
      return (
        s.party_code.toLowerCase().includes(q) ||
        s.name_en.toLowerCase().includes(q) ||
        blob.includes(q)
      );
    }).length;
  }, [rows, search]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Arrange shops"
      description="Choose overall, a city / head, or a sector. Search to jump to a shop, then drag or use arrows — first in the list shows first everywhere."
      className="max-w-xl"
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Show shops</Label>
            <Select
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as Scope);
                setSearch("");
                setHighlightId(null);
                setError(null);
              }}
              options={[
                { value: "overall", label: "Overall (all shops)" },
                { value: "city", label: "City / head wise" },
                { value: "sector", label: "Sector wise" },
              ]}
            />
          </div>
          {scope === "city" ? (
            <div>
              <Label>City / head</Label>
              <Select
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  setSearch("");
                  setHighlightId(null);
                }}
                options={[
                  { value: "", label: "Select city / head…" },
                  ...cityChoices.map((c) => ({ value: c, label: c })),
                ]}
              />
            </div>
          ) : null}
          {scope === "sector" ? (
            <div>
              <Label>Sector</Label>
              <Select
                value={sector}
                onChange={(e) => {
                  setSector(e.target.value);
                  setSearch("");
                  setHighlightId(null);
                }}
                options={[
                  { value: "", label: "Select sector…" },
                  ...sectorChoices.map((s) => ({ value: s, label: s })),
                ]}
              />
            </div>
          ) : null}
        </div>

        {!loading && !needsPick && rows.length > 0 ? (
          <div>
            <Label htmlFor="arrange-shop-search">Search shop</Label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
              <Input
                id="arrange-shop-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Code or shop name…"
                className="pl-9"
                autoComplete="off"
              />
            </div>
            {search.trim() ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                {searchMatchCount === 0
                  ? "No shop matches — try another code or name."
                  : searchMatchCount === 1
                    ? "1 match · highlighted below — drag to move."
                    : `${searchMatchCount} matches · jumped to best match (highlighted).`}
              </p>
            ) : (
              <p className="mt-1 text-xs text-[var(--muted)]">
                Type to find a shop; it scrolls into view and highlights so you
                can drag it.
              </p>
            )}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-[var(--muted)]">Loading shops…</p>
        ) : needsPick ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-6 text-center text-sm text-[var(--muted)]">
            {scope === "city"
              ? "Pick a city / head to list its shops."
              : "Pick a sector to list its shops."}
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-6 text-center text-sm text-[var(--muted)]">
            No shops for this filter.
          </p>
        ) : (
          <div
            ref={listRef}
            className="max-h-[50vh] overflow-y-auto rounded-lg border border-[var(--border)]"
          >
            <ul className="divide-y divide-[var(--border)]">
              {rows.map((shop, index) => {
                const highlighted = highlightId === shop.id;
                return (
                  <li
                    key={shop.id}
                    data-shop-id={shop.id}
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndex === null) return;
                      setRows((prev) => moveItem(prev, dragIndex, index));
                      setDragIndex(null);
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 text-sm transition-colors",
                      highlighted
                        ? "bg-amber-50 ring-1 ring-inset ring-amber-200"
                        : "bg-white",
                      dragIndex === index && "opacity-60",
                    )}
                  >
                    <GripVertical className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                    <span className="w-8 shrink-0 text-xs text-[var(--muted)]">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-[var(--ink)]">
                        {shop.party_code} — {shop.name_en}
                      </p>
                      <p className="truncate text-xs text-[var(--muted)]">
                        {[cityHead(shop), shop.route]
                          .filter(Boolean)
                          .join(" · ") || "No city / sector"}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        aria-label="Move up"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={index === rows.length - 1}
                        onClick={() => move(index, 1)}
                        aria-label="Move down"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={saving}
            disabled={loading || needsPick || rows.length === 0}
            onClick={() => void save()}
          >
            Save arrangement
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

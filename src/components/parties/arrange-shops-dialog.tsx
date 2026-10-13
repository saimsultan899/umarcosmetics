"use client";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { putCachedRow } from "@/lib/offline/local-db";
import { hasLocalSqlite, localUpsertMaster } from "@/lib/offline/sqlite-client";
import { createClient } from "@/lib/supabase/client";
import type { Party } from "@/lib/types/database";
import { ArrowDown, ArrowUp, GripVertical, ListOrdered } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

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
        return;
      }
      next = allShops.filter((s) => cityHead(s) === city);
    } else if (scope === "sector") {
      if (!sector) {
        setRows([]);
        return;
      }
      next = allShops.filter((s) => (s.route || "").trim() === sector);
    }
    setRows(next);
  }, [allShops, scope, city, sector, open]);

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

  const needsPick =
    (scope === "city" && !city) || (scope === "sector" && !sector);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Arrange shops"
      description="Choose overall, a city / head, or a sector. Then move shops up or down — first in the list shows first everywhere."
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
                onChange={(e) => setCity(e.target.value)}
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
                onChange={(e) => setSector(e.target.value)}
                options={[
                  { value: "", label: "Select sector…" },
                  ...sectorChoices.map((s) => ({ value: s, label: s })),
                ]}
              />
            </div>
          ) : null}
        </div>

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
          <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-[var(--border)]">
            <ul className="divide-y divide-[var(--border)]">
              {rows.map((shop, index) => (
                <li
                  key={shop.id}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex === null) return;
                    setRows((prev) => moveItem(prev, dragIndex, index));
                    setDragIndex(null);
                  }}
                  onDragEnd={() => setDragIndex(null)}
                  className="flex items-center gap-2 bg-white px-3 py-2 text-sm"
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
                      {[cityHead(shop), shop.route].filter(Boolean).join(" · ") ||
                        "No city / sector"}
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
              ))}
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

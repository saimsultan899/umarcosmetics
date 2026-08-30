"use client";

import { LocationSelect, type LocationKind } from "@/components/forms/location-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { headFromCity } from "@/lib/locations";
import { createClient } from "@/lib/supabase/client";
import { Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LocationListsManager({
  companyId,
  organizationId,
  cityOptions,
  sectorOptions,
}: {
  companyId: string;
  organizationId: string;
  cityOptions: string[];
  sectorOptions: string[];
}) {
  const router = useRouter();
  const [cities, setCities] = useState(cityOptions);
  const [sectors, setSectors] = useState(sectorOptions);
  const [city, setCity] = useState("");
  const [sector, setSector] = useState("");

  function replaceInList(list: string[], from: string, to: string) {
    const next = list
      .map((item) => (item.toLowerCase() === from.toLowerCase() ? to : item))
      .filter((item, i, arr) => arr.findIndex((x) => x.toLowerCase() === item.toLowerCase()) === i)
      .sort((a, b) => a.localeCompare(b));
    return next;
  }

  function added(kind: LocationKind, name: string) {
    const add = (list: string[]) =>
      list.some((v) => v.toLowerCase() === name.toLowerCase())
        ? list
        : [...list, name].sort((a, b) => a.localeCompare(b));
    if (kind === "city") setCities(add);
    if (kind === "sector") setSectors(add);
    router.refresh();
  }

  function renamed(kind: LocationKind, from: string, to: string) {
    if (kind === "city") {
      setCities((list) => replaceInList(list, from, to));
      if (city.toLowerCase() === from.toLowerCase()) setCity(to);
    }
    if (kind === "sector") {
      setSectors((list) => replaceInList(list, from, to));
      if (sector.toLowerCase() === from.toLowerCase()) setSector(to);
    }
    router.refresh();
  }

  function removed(kind: LocationKind, name: string) {
    if (kind === "city") {
      setCities((list) => list.filter((item) => item.toLowerCase() !== name.toLowerCase()));
      if (city.toLowerCase() === name.toLowerCase()) setCity("");
    }
    if (kind === "sector") {
      setSectors((list) => list.filter((item) => item.toLowerCase() !== name.toLowerCase()));
      if (sector.toLowerCase() === name.toLowerCase()) setSector("");
    }
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--muted)]">
        City and head are the same list. Sector is separate. Use the pencil to
        rename and the delete icon to remove a name from every dropdown.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <LocationSelect
          companyId={companyId}
          organizationId={organizationId}
          kind="city"
          label="City / Head"
          value={city}
          options={cities}
          onChange={setCity}
          onAdded={(name) => added("city", name)}
        />
        <LocationSelect
          companyId={companyId}
          organizationId={organizationId}
          kind="sector"
          label="Sector"
          value={sector}
          options={sectors}
          onChange={setSector}
          onAdded={(name) => added("sector", name)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 text-sm">
        <OptionList
          title="Cities / Heads"
          items={cities}
          kind="city"
          companyId={companyId}
          organizationId={organizationId}
          onRenamed={(from, to) => renamed("city", from, to)}
          onRemoved={(name) => removed("city", name)}
        />
        <OptionList
          title="Sectors"
          items={sectors}
          kind="sector"
          companyId={companyId}
          organizationId={organizationId}
          onRenamed={(from, to) => renamed("sector", from, to)}
          onRemoved={(name) => removed("sector", name)}
        />
      </div>
    </div>
  );
}

function OptionList({
  title,
  items,
  kind,
  companyId,
  organizationId,
  onRenamed,
  onRemoved,
}: {
  title: string;
  items: string[];
  kind: "city" | "sector";
  companyId: string;
  organizationId: string;
  onRenamed: (from: string, to: string) => void;
  onRemoved: (name: string) => void;
}) {
  const [editingName, setEditingName] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {title} ({items.length})
      </p>
      <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
        {items.length ? (
          items.map((item) => (
            <OptionRow
              key={item}
              name={item}
              kind={kind}
              companyId={companyId}
              organizationId={organizationId}
              editing={editingName === item}
              onStartEdit={() => setEditingName(item)}
              onCancelEdit={() => setEditingName(null)}
              onRenamed={(from, to) => {
                setEditingName(null);
                onRenamed(from, to);
              }}
              onRemoved={onRemoved}
            />
          ))
        ) : (
          <li className="text-[var(--muted)]">None yet — click Add.</li>
        )}
      </ul>
    </div>
  );
}

function OptionRow({
  name,
  kind,
  companyId,
  organizationId,
  editing,
  onStartEdit,
  onCancelEdit,
  onRenamed,
  onRemoved,
}: {
  name: string;
  kind: "city" | "sector";
  companyId: string;
  organizationId: string;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onRenamed: (from: string, to: string) => void;
  onRemoved: (name: string) => void;
}) {
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancelEdit() {
    setDraft(name);
    setError(null);
    onCancelEdit();
  }

  async function saveRename() {
    const next = draft.trim();
    if (!next) {
      setError("Enter a name.");
      return;
    }
    if (next.toLowerCase() === name.toLowerCase()) {
      cancelEdit();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await renameLocation({
        companyId,
        organizationId,
        kind,
        from: name,
        to: next,
      });
      onRenamed(name, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteLocation({ companyId, kind, name });
      onRemoved(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <li className="space-y-1">
        <div className="flex items-center gap-1">
          <Input
            className="h-8 min-w-0 flex-1"
            value={draft}
            autoFocus
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void saveRename();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
              }
            }}
          />
          <Button type="button" size="sm" disabled={busy} onClick={() => void saveRename()}>
            {busy ? "..." : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 shrink-0 px-0"
            disabled={busy}
            aria-label="Cancel edit"
            onClick={cancelEdit}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {error ? <p className="text-xs text-rose-700">{error}</p> : null}
      </li>
    );
  }

  return (
    <li className="space-y-1">
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 shrink-0 px-0"
          disabled={busy}
          aria-label={`Edit ${name}`}
          onClick={() => {
            setDraft(name);
            setError(null);
            onStartEdit();
          }}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 shrink-0 px-0 text-rose-600 hover:text-rose-700"
          disabled={busy}
          aria-label={`Delete ${name}`}
          onClick={() => void remove()}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
    </li>
  );
}

async function renameLocation({
  companyId,
  organizationId,
  kind,
  from,
  to,
}: {
  companyId: string;
  organizationId: string;
  kind: "city" | "sector";
  from: string;
  to: string;
}) {
  const supabase = createClient();
  const { data: existing, error: findError } = await supabase
    .from("company_locations")
    .select("id")
    .eq("company_id", companyId)
    .eq("kind", kind)
    .eq("name", from)
    .maybeSingle();
  if (findError) throw new Error(findError.message);

  if (existing) {
    const { error } = await supabase
      .from("company_locations")
      .update({ name: to })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("company_locations").insert({
      organization_id: organizationId,
      company_id: companyId,
      kind,
      name: to,
    });
    if (error && !/duplicate|unique/i.test(error.message)) {
      throw new Error(error.message);
    }
  }

  if (kind === "city") {
    const oldHead = headFromCity(from);
    const newHead = headFromCity(to);
    if (oldHead && newHead && oldHead !== newHead) {
      await supabase
        .from("company_locations")
        .update({ name: newHead })
        .eq("company_id", companyId)
        .eq("kind", "head")
        .eq("name", oldHead);
    }
    const { error } = await supabase
      .from("parties")
      .update({ city: to, head: newHead })
      .eq("company_id", companyId)
      .eq("city", from);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase
    .from("parties")
    .update({ route: to })
    .eq("company_id", companyId)
    .eq("route", from);
  if (error) throw new Error(error.message);
}

async function deleteLocation({
  companyId,
  kind,
  name,
}: {
  companyId: string;
  kind: "city" | "sector";
  name: string;
}) {
  const supabase = createClient();
  const { error: locError } = await supabase
    .from("company_locations")
    .delete()
    .eq("company_id", companyId)
    .eq("kind", kind)
    .eq("name", name);
  if (locError) throw new Error(locError.message);

  if (kind === "city") {
    const head = headFromCity(name);
    if (head) {
      await supabase
        .from("company_locations")
        .delete()
        .eq("company_id", companyId)
        .eq("kind", "head")
        .eq("name", head);
    }
    const { error } = await supabase
      .from("parties")
      .update({ city: null, head: null })
      .eq("company_id", companyId)
      .eq("city", name);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase
    .from("parties")
    .update({ route: null })
    .eq("company_id", companyId)
    .eq("route", name);
  if (error) throw new Error(error.message);
}

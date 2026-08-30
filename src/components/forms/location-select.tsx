"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { headFromCity } from "@/lib/locations";
import { createClient } from "@/lib/supabase/client";
import { Plus, X } from "lucide-react";
import { useState } from "react";

export type LocationKind = "city" | "head" | "sector";

export function LocationSelect({
  companyId,
  organizationId,
  kind, 
  label,
  value,
  options,
  onChange,
  onAdded,
  placeholder,
}: {
  companyId: string;
  organizationId: string;
  kind: LocationKind;
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onAdded?: (value: string) => void;
  placeholder?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emptyLabel = placeholder || `Select ${label.toLowerCase()}`;

  function cancelAdd() {
    setDraft("");
    setError(null);
    setAdding(false);
  }

  async function saveNew() {
    const name = draft.trim();
    if (!name) {
      setError(`Enter a ${label.toLowerCase()} name.`);
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: saveError } = await supabase.from("company_locations").insert({
      organization_id: organizationId,
      company_id: companyId,
      kind,
      name,
    });
    if (saveError && !/duplicate|unique/i.test(saveError.message)) {
      setSaving(false);
      setError(saveError.message);
      return;
    }
    if (kind === "city") {
      const headName = headFromCity(name);
      if (headName) {
        await supabase.from("company_locations").insert({
          organization_id: organizationId,
          company_id: companyId,
          kind: "head",
          name: headName,
        });
      }
    }
    setSaving(false);
    onAdded?.(name);
    onChange(name);
    setDraft("");
    setAdding(false);
  }

  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-start gap-2">
        <Select
          className="min-w-0 flex-1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={emptyLabel}
        >
          <option value="">{emptyLabel}</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          variant="secondary"
          className="shrink-0"
          onClick={() => {
            if (adding) {
              cancelAdd();
              return;
            }
            setError(null);
            setAdding(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>
      {adding ? (
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <Input
              className="min-w-0 flex-1"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`New ${label.toLowerCase()}`}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void saveNew();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelAdd();
                }
              }}
            />
            <Button type="button" size="sm" disabled={saving} onClick={() => void saveNew()}>
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 shrink-0 px-0"
              disabled={saving}
              aria-label="Close add"
              onClick={cancelAdd}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {error ? <p className="text-xs text-rose-700">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

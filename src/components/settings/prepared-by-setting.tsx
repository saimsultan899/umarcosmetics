"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

export function PreparedBySetting({
  companyId,
  initialValue,
}: {
  companyId: string;
  initialValue?: string | null;
}) {
  const [value, setValue] = useState(String(initialValue || ""));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const supabase = createClient();
    const next = value.trim() || null;
    const { error: saveError } = await supabase
      .from("companies")
      .update({ prepared_by: next })
      .eq("id", companyId);
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setValue(next || "");
    setSaved(true);
  }

  return (
    <div className="panel p-5">
      <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
        Sale invoice — Prepared By
      </h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Shown at the bottom of printed sale invoices for this company.
      </p>
      <div className="mt-4 space-y-2">
        <Label htmlFor="prepared-by">Prepared By</Label>
        <Input
          id="prepared-by"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          placeholder="e.g. USMAN ISHAQ (0308-8664002)"
        />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button type="button" size="sm" loading={saving} onClick={() => void save()}>
          Save
        </Button>
        {saved ? (
          <span className="text-sm text-emerald-700">Saved</span>
        ) : null}
      </div>
      {error ? (
        <p className="mt-3 text-sm text-rose-700">{error}</p>
      ) : null}
    </div>
  );
}

"use client";

import { createClient } from "@/lib/supabase/client";
import {
  normalizeSaleStockPolicy,
  type SaleStockPolicy,
} from "@/lib/trading/sale-stock-policy";
import { useState } from "react";

export function SaleStockPolicySetting({
  companyId,
  initialPolicy,
}: {
  companyId: string;
  initialPolicy?: string | null;
}) {
  const [policy, setPolicy] = useState<SaleStockPolicy>(
    normalizeSaleStockPolicy(initialPolicy),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(next: SaleStockPolicy) {
    if (next === policy || saving) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: saveError } = await supabase
      .from("companies")
      .update({ sale_stock_policy: next })
      .eq("id", companyId);
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    setPolicy(next);
  }

  return (
    <div className="panel p-5">
      <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
        Sale stock check
      </h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        A quantity far above the shelf is refused either way, so a mistyped
        number cannot post. This choice is for the whole company.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] p-3">
          <input
            type="radio"
            name="sale-stock-policy"
            className="mt-1"
            checked={policy === "block"}
            disabled={saving}
            onChange={() => void choose("block")}
          />
          <span>
            <span className="block text-sm font-semibold">Stop the sale</span>
            <span className="mt-0.5 block text-xs text-[var(--muted)]">
              The bill cannot be saved when the quantity is more than the stock on hand.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] p-3">
          <input
            type="radio"
            name="sale-stock-policy"
            className="mt-1"
            checked={policy === "confirm"}
            disabled={saving}
            onChange={() => void choose("confirm")}
          />
          <span>
            <span className="block text-sm font-semibold">Warn, then allow</span>
            <span className="mt-0.5 block text-xs text-[var(--muted)]">
              A short shelf asks before saving. Stock can go negative. A wild quantity is still refused.
            </span>
          </span>
        </label>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-rose-700">{error}</p>
      ) : null}
    </div>
  );
}

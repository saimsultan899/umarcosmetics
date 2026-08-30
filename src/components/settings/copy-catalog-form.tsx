"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { Company } from "@/lib/types/database";
import { FormEvent, useMemo, useState } from "react";

type CopyResult = {
  products_copied: number;
  products_skipped: number;
  source_products: number;
  warehouses_created: number;
  from_company: string;
  to_company: string;
};

export function CopyCatalogForm({
  companies,
  currentCompanyId,
}: {
  companies: Company[];
  currentCompanyId: string;
}) {
  const others = useMemo(
    () => companies.filter((c) => c.id !== currentCompanyId),
    [companies, currentCompanyId],
  );

  const [fromId, setFromId] = useState(currentCompanyId);
  const [toId, setToId] = useState(others[0]?.id || "");
  const [copyWarehouses, setCopyWarehouses] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fromName = companies.find((c) => c.id === fromId)?.name || "Source";
  const toName = companies.find((c) => c.id === toId)?.name || "Target";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!fromId || !toId || fromId === toId) {
      setError("Choose two different companies.");
      return;
    }

    const ok = window.confirm(
      `Copy product catalog from "${fromName}" to "${toName}"?\n\n` +
        `• Products with new codes will be created\n` +
        `• Existing product codes will be skipped\n` +
        `• Opening stock will NOT be copied (starts at 0)\n` +
        (copyWarehouses
          ? "• Matching companies will be created/updated\n"
          : "• Companies will not be copied\n") +
        `\nCompanies stay separate — this only copies masters.`,
    );
    if (!ok) return;

    setLoading(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc(
      "copy_products_between_companies",
      {
        p_from_company_id: fromId,
        p_to_company_id: toId,
        p_copy_warehouses: copyWarehouses,
      },
    );
    setLoading(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const result = data as CopyResult;
    setMessage(
      `Done: ${result.products_copied} products copied from ${result.from_company} → ${result.to_company}. ` +
        `Skipped ${result.products_skipped} existing codes. ` +
        (copyWarehouses
          ? `Companies created: ${result.warehouses_created}.`
          : "Companies not copied."),
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>From company</Label>
          <Select
            value={fromId}
            onChange={(e) => {
              const next = e.target.value;
              setFromId(next);
              if (next === toId) {
                setToId(companies.find((c) => c.id !== next)?.id || "");
              }
            }}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>To company</Label>
          <Select value={toId} onChange={(e) => setToId(e.target.value)}>
            {companies
              .filter((c) => c.id !== fromId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
        <input
          type="checkbox"
          checked={copyWarehouses}
          onChange={(e) => setCopyWarehouses(e.target.checked)}
          className="h-4 w-4 rounded border-[var(--border)]"
        />
        Also copy / sync companies
      </label>

      <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3 text-xs text-[var(--muted)]">
        Will copy active products from <strong>{fromName}</strong> into{" "}
        <strong>{toName}</strong>. Stock quantities stay at 0 on the target
        company. Parties, invoices, and balances are never copied.
      </p>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      <Button type="submit" disabled={loading || !toId}>
        {loading ? "Copying catalog..." : "Copy product catalog"}
      </Button>
    </form>
  );
}

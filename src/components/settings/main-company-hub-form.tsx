"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useSingleSubmit } from "@/lib/forms/single-submit";
import { createClient } from "@/lib/supabase/client";
import type { Company } from "@/lib/types/database";
import { FormEvent, useState } from "react";

type SyncResult = {
  main_company_id: string;
  main_company_name: string;
  products_synced: number;
  parties_synced: number;
  warehouses_touched: number;
};

export function MainCompanyHubForm({
  organizationId,
  companies,
  initialMainCompanyId,
}: {
  organizationId: string;
  companies: Company[];
  initialMainCompanyId: string | null;
}) {
  const [mainId, setMainId] = useState(initialMainCompanyId || "");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const singleSubmit = useSingleSubmit();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mainName = companies.find((c) => c.id === mainId)?.name || "Main";

  async function saveMain(e: FormEvent) {
    e.preventDefault();
    await singleSubmit(async () => {
      setError(null);
      setMessage(null);
      setLoading(true);
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc(
        "set_organization_main_company",
        {
          p_organization_id: organizationId,
          p_main_company_id: mainId || null,
        },
      );
      setLoading(false);
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      const result = data as { main_company_name?: string | null };
      try {
        const {
          cacheHubContext,
          prefetchMainCompanyHubCaches,
          getCachedSessionData,
        } = await import("@/lib/offline/cache-manager");
        const session = await getCachedSessionData();
        const activeCompanyId =
          (session?.company?.id as string | undefined) ||
          companies.find((c) => c.id === mainId)?.id ||
          companies[0]?.id ||
          "";
        await cacheHubContext({
          organizationId,
          mainCompanyId: mainId || null,
          spokeCompanyId: activeCompanyId,
        });
        if (mainId && activeCompanyId) {
          await prefetchMainCompanyHubCaches(activeCompanyId);
        }
      } catch {
        /* offline cache best-effort */
      }
      setMessage(
        mainId
          ? `${result.main_company_name || mainName} is now the main company. Run sync to pull products and shops from the others.`
          : "Main company cleared. Companies work separately again.",
      );
    });
  }

  async function syncNow() {
    await singleSubmit(async () => {
      setError(null);
      setMessage(null);
      if (!mainId) {
        setError("Choose and save a main company first.");
        return;
      }
      const ok = window.confirm(
        `Sync all products and shops from other companies into "${mainName}"?\n\n` +
          `• Product rates, barcodes, and details stay linked\n` +
          `• Shops / customers are copied onto main\n` +
          `• Invoices and balances stay separate on each company\n` +
          `• Later purchases on other companies also restock main`,
      );
      if (!ok) return;

      setSyncing(true);
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc(
        "sync_organization_hub_catalog",
        { p_organization_id: organizationId },
      );
      setSyncing(false);
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      const result = data as SyncResult;
      try {
        const { prefetchMainCompanyHubCaches } = await import(
          "@/lib/offline/cache-manager"
        );
        const active =
          companies.find((c) => c.id !== mainId)?.id || companies[0]?.id;
        if (active) await prefetchMainCompanyHubCaches(active);
        else if (mainId) await prefetchMainCompanyHubCaches(mainId);
      } catch {
        /* ignore */
      }
      setMessage(
        `Synced into ${result.main_company_name}: ${result.products_synced} products, ${result.parties_synced} shops/vendors, ${result.warehouses_touched} brand companies checked.`,
      );
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={saveMain} className="space-y-4">
        <div>
          <Label>Main company</Label>
          <Select value={mainId} onChange={(e) => setMainId(e.target.value)}>
            <option value="">None — each company stays separate</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3 text-xs text-[var(--muted)]">
          Main holds the shared product list, rates, stock position from purchases,
          and shops. Other companies keep their own invoices and ledgers. A
          purchase on a non-main company also restocks the matching product on
          main. Groups with only one company should leave this on None.
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

        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={loading}>
            {loading ? "Saving..." : "Save main company"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            loading={syncing}
            disabled={!mainId}
            onClick={() => void syncNow()}
          >
            {syncing ? "Syncing..." : "Sync products & shops to main"}
          </Button>
        </div>
      </form>
    </div>
  );
}

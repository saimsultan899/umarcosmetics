"use client";

import { FieldRecoveryForm } from "@/components/field/field-recovery-form";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useSyncStatus } from "@/components/offline/sync-provider";
import { getCachedRows } from "@/lib/offline/local-db";
import type { Party } from "@/lib/types/database";
import { useEffect, useMemo, useState } from "react";

type Shop = {
  party_id: string;
  party_code: string;
  name_en: string;
  balance: number;
};

function isCustomer(p: Party) {
  return (
    p.party_subtype === "customer" ||
    p.party_subtype === "both" ||
    p.party_type === "PARTY"
  );
}

export function FieldRecoveryView({
  companyId,
  organizationId,
  initialShops,
  initialOffline = false,
}: {
  companyId: string;
  organizationId: string;
  initialShops?: Shop[];
  initialOffline?: boolean;
}) {
  const sync = useSyncStatus();
  const isOnline = sync ? sync.online : !initialOffline;

  const [shops, setShops] = useState<Shop[]>(initialShops || []);
  const [loading, setLoading] = useState(!initialShops || initialShops.length === 0);

  useEffect(() => {
    if (initialShops && initialShops.length > 0 && isOnline) return;

    void (async () => {
      setLoading(true);
      try {
        const { hasLocalSqlite, localListMaster } = await import("@/lib/offline/sqlite-client");

        let partyRows: Record<string, unknown>[] = [];

        if (hasLocalSqlite()) {
          const res = await localListMaster("parties", companyId, 5000);
          if (res.ok && res.rows?.length) partyRows = res.rows;
        }

        if (!partyRows.length) partyRows = await getCachedRows("parties", companyId);

        const parties = partyRows as unknown as Party[];
        setShops(
          parties.filter(isCustomer).map((p) => ({
            party_id: p.id,
            party_code: p.party_code,
            name_en: p.name_en,
            balance: 0,
          })),
        );
      } catch (err) {
        console.error("Failed to load offline shops for field recovery:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [companyId, initialShops, isOnline]);

  if (loading) {
    return (
      <div className="animate-rise mx-auto w-full max-w-3xl space-y-5">
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div className="animate-rise mx-auto w-full max-w-3xl space-y-5">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold sm:text-3xl">
          Collect recovery
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Works offline — syncs to main accounts when online
        </p>
      </div>
      <div className="panel p-4 sm:p-6">
        {shops.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No customers found. Connect once and refresh caches, then try again.
          </p>
        ) : (
          <FieldRecoveryForm
            companyId={companyId}
            organizationId={organizationId}
            shops={shops}
          />
        )}
      </div>
    </div>
  );
}

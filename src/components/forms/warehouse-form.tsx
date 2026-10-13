"use client";

import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import { useSingleSubmit } from "@/lib/forms/single-submit";
import { getCachedRows } from "@/lib/offline/local-db";
import { offlineAwareSubmit } from "@/lib/offline/offline-submit";
import { createClient } from "@/lib/supabase/client";
import type { Warehouse } from "@/lib/types/database";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

export function WarehouseForm({
  companyId,
  organizationId,
  initial,
  onDone,
}: {
  companyId: string;
  organizationId: string;
  initial?: Warehouse | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  const [loading, setLoading] = useState(false);
  const singleSubmit = useSingleSubmit();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(initial?.name || "");
  const [code, setCode] = useState(initial?.code || "");
  const [address, setAddress] = useState(initial?.address || "");
  const [vendorId, setVendorId] = useState(initial?.default_supplier_id || "");
  const [vendors, setVendors] = useState<Array<{ value: string; label: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    function toOptions(rows: Array<Record<string, unknown>>) {
      return rows
        .filter((p) => {
          const active = p.is_active;
          if (active === false || active === 0 || active === "0" || active === "false") {
            return false;
          }
          const subtype = String(p.party_subtype || "");
          return subtype === "supplier" || subtype === "both";
        })
        .map((p) => ({
          value: String(p.id),
          label: `${p.party_code || ""} — ${p.name_en || "Vendor"}`.replace(/^ — /, ""),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    (async () => {
      try {
        if (typeof navigator === "undefined" || navigator.onLine) {
          const supabase = createClient();
          const { data, error } = await supabase
            .from("parties")
            .select("id, party_code, name_en, party_subtype, party_type, is_active")
            .eq("company_id", companyId)
            .eq("is_active", true)
            .order("name_en")
            .limit(10000);
          if (!cancelled && !error && data) {
            setVendors(
              data
                .filter(
                  (p) => p.party_subtype === "supplier" || p.party_subtype === "both",
                )
                .map((p) => ({
                  value: String(p.id),
                  label: `${p.party_code} — ${p.name_en}`,
                })),
            );
            return;
          }
        }
      } catch {
        // Fall through to the local vendor list.
      }
      const rows: Array<Record<string, unknown>> = [];
      try {
        const { hasLocalSqlite, localListMaster } = await import(
          "@/lib/offline/sqlite-client"
        );
        if (hasLocalSqlite()) {
          const res = await localListMaster("parties", companyId, 10000);
          if (res.rows?.length) rows.push(...res.rows);
        }
      } catch {
        // Desktop party list is optional.
      }
      try {
        const cached = await getCachedRows("parties", companyId);
        if (cached.length) rows.push(...(cached as Array<Record<string, unknown>>));
      } catch {
        // IndexedDB is optional.
      }
      if (!cancelled) setVendors(toOptions(rows));
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await singleSubmit(async () => {
    setLoading(true);
    setError(null);
    const payload: Record<string, unknown> = initial
      ? {
          id: initial.id,
          name: name.trim(),
          code: code.trim() || null,
          address: address.trim() || null,
          default_supplier_id: vendorId || null,
        }
      : {
          organization_id: organizationId,
          company_id: companyId,
          name: name.trim(),
          code: code.trim() || null,
          address: address.trim() || null,
          default_supplier_id: vendorId || null,
          is_active: true,
        };

    try {
      const saved = await offlineAwareSubmit({
        mutationType: initial ? "warehouse_update" : "warehouse_create",
        companyId,
        organizationId,
        cacheStore: "warehouses",
        cacheRecord: payload,
        payload,
      });
      const warehouseId = saved?.id || initial?.id;
      if (warehouseId && navigator.onLine) {
        const supabase = createClient();
        const { error: linkError } = await supabase.rpc("set_warehouse_supplier", {
          p_warehouse_id: warehouseId,
          p_supplier_id: vendorId || null,
        });
        if (linkError) throw new Error(linkError.message);
      }

      setLoading(false);
      if (!initial) {
        setName("");
        setCode("");
        setAddress("");
        setVendorId("");
      }
      onDone?.();
      closeDialog?.();
      router.refresh();
    } catch (err: any) {
      setLoading(false);
      setError(err?.message || String(err));
    }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 sm:grid-cols-3"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >      <div>
        <Label>Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="KEUNE"
        />
      </div>
      <div>
        <Label>Code</Label>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="KEUNE"
        />
      </div>
      <div>
        <Label>Address</Label>
        <Input value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="sm:col-span-3">
        <Label>Vendor (optional)</Label>
        <Select
          value={vendorId}
          maxVisible={10000}
          onChange={(e) => setVendorId(e.target.value)}
          options={[
            { value: "", label: "No vendor — company ledger only" },
            ...vendors,
          ]}
        />
        <p className="mt-1 text-xs text-[var(--muted)]">
          Several companies can use the same vendor. Leave blank if this company
          has no supplier ledger.
        </p>
      </div>
      {error ? (
        <p className="sm:col-span-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <div className="sm:col-span-3">
        <Button type="submit" loading={loading}>
          {loading
            ? "Saving..."
            : initial
              ? "Update company"
              : "Add company"}
        </Button>
      </div>
    </form>
  );
}

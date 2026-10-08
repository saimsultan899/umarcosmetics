"use client";

import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { ReportTable } from "@/components/reports/report-table";
import { ReportFilterActions } from "@/components/reports/report-filters";
import { UrlFilterForm } from "@/components/reports/url-filter-form";
import { useSyncStatus } from "@/components/offline/sync-provider";
import { Select } from "@/components/ui/select";
import { localDateIso, monthStartLocal } from "@/lib/dates";
import { getCachedRows } from "@/lib/offline/local-db";
import {
  buildCompanyStatement,
  type CompanyStatement,
} from "@/lib/reports/company-statement";
import { buildOfflineCompanyStatement } from "@/lib/reports/company-statement-offline";
import { createClient } from "@/lib/supabase/client";
import { Boxes, Package, ShoppingCart, Truck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type WarehouseOption = { id: string; name: string };

function isInactive(value: unknown) {
  return value === false || value === 0 || value === "0" || value === "false";
}

function warehouseOptions(rows: Array<Record<string, unknown>>): WarehouseOption[] {
  const byId = new Map<string, WarehouseOption>();
  for (const row of rows) {
    if (!row.id || isInactive(row.is_active)) continue;
    byId.set(String(row.id), {
      id: String(row.id),
      name: String(row.name || "Company"),
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function CompanyStatementClient({
  companyId,
  companyName,
  initialWarehouses = [],
}: {
  companyId: string;
  companyName: string;
  initialWarehouses?: WarehouseOption[];
}) {
  const { online } = useSyncStatus();
  const sp = useSearchParams();
  const from = sp.get("from") || monthStartLocal();
  const to = sp.get("to") || localDateIso();
  const warehouseId = sp.get("company") || "";

  const [warehouses, setWarehouses] = useState<WarehouseOption[]>(initialWarehouses);
  const [warehousesReady, setWarehousesReady] = useState(initialWarehouses.length > 0);
  const [statement, setStatement] = useState<CompanyStatement | null>(null);
  const [usingLocal, setUsingLocal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadWarehouses() {
      const collected: Array<Record<string, unknown>> = [];
      try {
        const { hasLocalSqlite, localListMaster } = await import(
          "@/lib/offline/sqlite-client"
        );
        if (hasLocalSqlite()) {
          const res = await localListMaster("warehouses", companyId);
          if (res.rows?.length) collected.push(...res.rows);
        }
      } catch {
        // Desktop database is optional.
      }
      try {
        const cached = await getCachedRows("warehouses", companyId);
        if (cached.length) collected.push(...cached);
      } catch {
        // IndexedDB is optional.
      }
      if (!cancelled && collected.length) {
        setWarehouses(warehouseOptions([...initialWarehouses, ...collected]));
      }
      if (online) {
        try {
          const supabase = createClient();
          const { data, error: whError } = await supabase
            .from("warehouses")
            .select("id, name, is_active")
            .eq("company_id", companyId)
            .eq("is_active", true)
            .order("name");
          if (!cancelled && !whError && data?.length) {
            setWarehouses(
              warehouseOptions([...initialWarehouses, ...collected, ...data]),
            );
          }
        } catch {
          // Keep the local company list when the live read fails.
        }
      }
      if (!cancelled) setWarehousesReady(true);
    }
    loadWarehouses();
    return () => {
      cancelled = true;
    };
  }, [companyId, online]);

  useEffect(() => {
    if (!warehouseId) {
      setStatement(null);
      setLoading(false);
      setError("");
      setUsingLocal(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    const local = () =>
      buildOfflineCompanyStatement({
        companyId,
        warehouseId,
        from,
        to,
      });
    const finish = (next: CompanyStatement, fromLocal: boolean) => {
      if (cancelled) return;
      setStatement(next);
      setUsingLocal(fromLocal);
      setLoading(false);
    };
    const fail = (err: unknown) => {
      if (cancelled) return;
      setStatement(null);
      setUsingLocal(false);
      setError(err instanceof Error ? err.message : "Could not load the statement.");
      setLoading(false);
    };
    if (!online) {
      local().then((next) => finish(next, true)).catch(fail);
      return () => {
        cancelled = true;
      };
    }
    const supabase = createClient();
    buildCompanyStatement(supabase, {
      companyId,
      warehouseId,
      from,
      to,
    })
      .then((next) => finish(next, false))
      .catch(() => {
        local().then((next) => finish(next, true)).catch(fail);
      });
    return () => {
      cancelled = true;
    };
  }, [online, companyId, warehouseId, from, to]);

  return (
    <div className="animate-rise space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          Company statement
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Stock, purchases, and sales for one product company — {companyName}.
          Payments to the vendor stay on that vendor&apos;s ledger.
        </p>
      </div>

      <UrlFilterForm
        key={`${warehouseId}|${from}|${to}`}
        className="panel no-print flex flex-wrap items-end gap-3 p-4"
      >
        <div className="w-72 max-w-full shrink-0">
          <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
            Company
          </label>
          <Select
            name="company"
            defaultValue={warehouseId}
            options={[
              {
                value: "",
                label: warehousesReady ? "Select company" : "Loading companies…",
              },
              ...warehouses.map((w) => ({ value: w.id, label: w.name })),
            ]}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
            From
          </label>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="h-10 rounded-lg border border-[var(--border)] px-3 text-sm"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
            To
          </label>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="h-10 rounded-lg border border-[var(--border)] px-3 text-sm"
          />
        </div>
        <ReportFilterActions submitLabel="Run statement" nowrap className="shrink-0" />
      </UrlFilterForm>

      {!warehouseId ? (
        <p className="text-sm text-[var(--muted)]">
          Select a company and a date range.
        </p>
      ) : loading ? (
        <p className="text-sm text-[var(--muted)]">Reading stock, purchases, and sales…</p>
      ) : error ? (
        <p className="text-sm text-[var(--danger)]">{error}</p>
      ) : statement ? (
        <>
          <StatsGrid>
            <StatCard
              label="Opening stock"
              value={statement.openingValue}
              format="money"
              icon={Boxes}
              hint={`${statement.warehouseName} · qty ${statement.openingQty}`}
            />
            <StatCard
              label="Purchases"
              value={statement.purchaseAmount}
              format="money"
              icon={Truck}
              hint={`Bills and line amounts · qty in ${statement.purchaseQty}`}
            />
            <StatCard
              label="Sales"
              value={statement.saleAmount}
              format="money"
              icon={ShoppingCart}
              tone="ok"
              hint={`Qty out ${statement.saleQty}`}
            />
            <StatCard
              label="Closing stock"
              value={statement.closingValue}
              format="money"
              icon={Package}
              hint={`${statement.warehouseName} · qty ${statement.closingQty}`}
            />
          </StatsGrid>

          <ReportTable
            title={`${statement.warehouseName} — summary`}
            companyName={companyName}
            subtitle={`${from} to ${to}. Purchase amount is the purchase invoice total for this company's products. Vendor payments stay on the vendor ledger.${
              usingLocal ? " Figures are from the books saved on this computer." : ""
            }`}
            rows={statement.summary}
            filename={`company-statement-${statement.warehouseName}`}
            showFooter={false}
          />

          <ReportTable
            title={`${statement.warehouseName} — movements`}
            companyName={companyName}
            subtitle={`${statement.lines.length} lines. Qty in is positive. Qty out is negative.`}
            rows={statement.lines}
            filename={`company-movements-${statement.warehouseName}`}
          />
        </>
      ) : null}
    </div>
  );
}

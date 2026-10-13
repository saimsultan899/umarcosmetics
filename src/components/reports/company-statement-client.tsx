"use client";

import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { ReportTable } from "@/components/reports/report-table";
import { ReportFilterActions } from "@/components/reports/report-filters";
import { UrlFilterForm } from "@/components/reports/url-filter-form";
import { useSyncStatus } from "@/components/offline/sync-provider";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { localDateIso, monthStartLocal } from "@/lib/dates";
import { getCachedRows } from "@/lib/offline/local-db";
import { offlineAwareSubmit } from "@/lib/offline/offline-submit";
import {
  buildCompanyStatement,
  mergeCompanyStatements,
  paymentMethodLabel,
  type CompanyStatement,
  type CompanyStatementSupplier,
} from "@/lib/reports/company-statement";
import { buildOfflineCompanyStatement } from "@/lib/reports/company-statement-offline";
import { createClient } from "@/lib/supabase/client";
import { BankPaymentFields } from "@/components/vouchers/bank-payment-fields";
import { AMOUNT_PLACEHOLDER, AMOUNT_STEP, formatPkr } from "@/lib/utils";
import {
  Banknote,
  Boxes,
  Package,
  ShoppingCart,
  Truck,
  Wallet,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

type WarehouseOption = {
  id: string;
  name: string;
  supplierId?: string | null;
};
type SupplierOption = { value: string; label: string };

function isInactive(value: unknown) {
  return value === false || value === 0 || value === "0" || value === "false";
}

async function currentWarehouseRecord(
  companyId: string,
  warehouseId: string,
): Promise<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  try {
    const { hasLocalSqlite, localListMaster } = await import(
      "@/lib/offline/sqlite-client"
    );
    if (hasLocalSqlite()) {
      const res = await localListMaster("warehouses", companyId);
      if (res.rows?.length) rows.push(...res.rows);
    }
  } catch {
    // Desktop database is optional.
  }
  try {
    const cached = await getCachedRows("warehouses", companyId);
    if (cached.length) rows.push(...(cached as Array<Record<string, unknown>>));
  } catch {
    // IndexedDB is optional.
  }
  return rows.find((row) => String(row.id) === warehouseId) || { id: warehouseId };
}

function warehouseOptions(rows: Array<Record<string, unknown>>): WarehouseOption[] {
  const byId = new Map<string, WarehouseOption>();
  for (const row of rows) {
    if (!row.id || isInactive(row.is_active)) continue;
    const id = String(row.id);
    const prev = byId.get(id);
    const rawSupplier = row.default_supplier_id;
    byId.set(id, {
      id,
      name: String(row.name || prev?.name || "Company"),
      supplierId:
        rawSupplier != null && String(rawSupplier) !== ""
          ? String(rawSupplier)
          : (prev?.supplierId ?? null),
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function CompanyStatementClient({
  companyId,
  organizationId,
  companyName,
  initialWarehouses = [],
}: {
  companyId: string;
  organizationId: string;
  companyName: string;
  initialWarehouses?: WarehouseOption[];
}) {
  const { online } = useSyncStatus();
  const sp = useSearchParams();
  const from = sp.get("from") || monthStartLocal();
  const to = sp.get("to") || localDateIso();
  const view = sp.get("view") === "vendor" ? "vendor" : "company";
  const [viewDraft, setViewDraft] = useState<"company" | "vendor">(view);
  const warehouseId = sp.get("company") || "";
  const vendorIdParam = sp.get("vendor") || "";
  const methodFilter = sp.get("method") || "";

  const [warehouses, setWarehouses] = useState<WarehouseOption[]>(initialWarehouses);
  const [warehousesReady, setWarehousesReady] = useState(initialWarehouses.length > 0);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [statement, setStatement] = useState<CompanyStatement | null>(null);
  const [usingLocal, setUsingLocal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [vendorOpen, setVendorOpen] = useState(false);
  const [vendorId, setVendorId] = useState("");
  const [vendorSaving, setVendorSaving] = useState(false);
  const [vendorError, setVendorError] = useState<string | null>(null);

  const [payOpen, setPayOpen] = useState(false);
  const [payWarehouseId, setPayWarehouseId] = useState("");
  const [payDate, setPayDate] = useState(localDateIso());
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("cash");
  const [senderBank, setSenderBank] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderNo, setSenderNo] = useState("");
  const [receiverBank, setReceiverBank] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [receiverNo, setReceiverNo] = useState("");
  const [payRemarks, setPayRemarks] = useState("");
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

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
            .select("id, name, is_active, default_supplier_id")
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
  }, [companyId, online, initialWarehouses]);

  useEffect(() => {
    let cancelled = false;
    function toOptions(rows: Array<Record<string, unknown>>) {
      return rows
        .filter((p) => {
          if (!p.id || isInactive(p.is_active)) return false;
          const subtype = String(p.party_subtype || "");
          return subtype === "supplier" || subtype === "both";
        })
        .map((p) => ({
          value: String(p.id),
          label: `${p.party_code || ""} — ${p.name_en || "Vendor"}`.replace(/^ — /, ""),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    async function loadLocalSuppliers() {
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
      return toOptions(rows);
    }
    (async () => {
      if (online) {
        try {
          const supabase = createClient();
          const { data, error } = await supabase
            .from("parties")
            .select("id, party_code, name_en, party_subtype, is_active")
            .eq("company_id", companyId)
            .eq("is_active", true)
            .in("party_subtype", ["supplier", "both"])
            .order("name_en")
            .limit(10000);
          if (cancelled) return;
          if (!error && data) {
            setSuppliers(
              data.map((p) => ({
                value: String(p.id),
                label: `${p.party_code} — ${p.name_en}`,
              })),
            );
            return;
          }
        } catch {
          // Fall through to the local vendor list.
        }
      }
      const local = await loadLocalSuppliers();
      if (!cancelled) setSuppliers(local);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, online]);

  const vendorWarehouses = useMemo(
    () =>
      vendorIdParam
        ? warehouses.filter((w) => w.supplierId === vendorIdParam)
        : [],
    [warehouses, vendorIdParam],
  );

  useEffect(() => {
    const wantsVendor = view === "vendor";
    if (!wantsVendor && !warehouseId) {
      setStatement(null);
      setLoading(false);
      setError("");
      setUsingLocal(false);
      return;
    }
    if (wantsVendor && !vendorIdParam) {
      setStatement(null);
      setLoading(false);
      setError("");
      setUsingLocal(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    const ids = wantsVendor
      ? vendorWarehouses.map((w) => w.id)
      : [warehouseId];
    const vendorParty = suppliers.find((s) => s.value === vendorIdParam);
    const vendor: CompanyStatementSupplier = vendorParty
      ? {
          id: vendorParty.value,
          party_code: vendorParty.label.split(" — ")[0] || "",
          name_en: vendorParty.label.split(" — ").slice(1).join(" — "),
        }
      : null;
    const title = vendor
      ? `${vendor.party_code} — ${vendor.name_en}`
      : "Vendor";

    const loadOne = (id: string, fromLocal: boolean) =>
      fromLocal
        ? buildOfflineCompanyStatement({ companyId, warehouseId: id, from, to })
        : buildCompanyStatement(createClient(), { companyId, warehouseId: id, from, to });

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

    async function run(fromLocal: boolean) {
      if (!ids.length) {
        finish(mergeCompanyStatements([], vendor, title), fromLocal);
        return;
      }
      const parts = await Promise.all(ids.map((id) => loadOne(id, fromLocal)));
      finish(
        wantsVendor ? mergeCompanyStatements(parts, vendor, title) : parts[0],
        fromLocal,
      );
    }

    if (!online) {
      run(true).catch(fail);
      return () => {
        cancelled = true;
      };
    }
    run(false).catch(() => {
      run(true).catch(fail);
    });
    return () => {
      cancelled = true;
    };
  }, [
    online,
    companyId,
    warehouseId,
    view,
    vendorIdParam,
    vendorWarehouses,
    suppliers,
    from,
    to,
    reloadKey,
  ]);

  useEffect(() => {
    setViewDraft(view);
  }, [view]);

  useEffect(() => {
    setVendorId(statement?.supplier?.id || "");
  }, [statement?.supplier?.id]);

  useEffect(() => {
    if (view === "company") {
      setPayWarehouseId(warehouseId);
      return;
    }
    setPayWarehouseId(statement?.linkedCompanies?.[0]?.id || "");
  }, [view, warehouseId, statement?.linkedCompanies]);

  const payableRows = useMemo(() => {
    const rows = statement?.payableLedger || [];
    if (!methodFilter) return rows;
    const want = paymentMethodLabel(methodFilter);
    return rows.filter((r) => {
      const method = String(r.Method || "");
      if (method === "—" || method === "") return true;
      return method === want;
    });
  }, [statement?.payableLedger, methodFilter]);

  async function saveVendor(e: FormEvent) {
    e.preventDefault();
    if (!warehouseId) return;
    setVendorSaving(true);
    setVendorError(null);
    try {
      const existing = await currentWarehouseRecord(companyId, warehouseId);
      const active = existing.is_active;
      const payload: Record<string, unknown> = {
        id: warehouseId,
        company_id: companyId,
        organization_id: existing.organization_id || organizationId,
        name:
          String(existing.name || statement?.warehouseName || "").trim() ||
          "Company",
        code: existing.code ?? null,
        address: existing.address ?? null,
        is_active: !(
          active === false ||
          active === 0 ||
          active === "0" ||
          active === "false"
        ),
        default_supplier_id: vendorId || null,
      };
      await offlineAwareSubmit({
        mutationType: "warehouse_update",
        companyId,
        organizationId,
        cacheStore: "warehouses",
        cacheRecord: payload,
        payload,
      });
      setWarehouses((rows) =>
        rows.map((row) =>
          row.id === warehouseId ? { ...row, supplierId: vendorId || null } : row,
        ),
      );
      setVendorOpen(false);
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      setVendorError(err?.message || String(err));
    } finally {
      setVendorSaving(false);
    }
  }

  async function savePayment(e: FormEvent) {
    e.preventDefault();
    const payWarehouse =
      view === "vendor" ? payWarehouseId : warehouseId;
    if (!payWarehouse) {
      setPayError(
        view === "vendor"
          ? "Choose which linked company this payment is for."
          : "Select a company first.",
      );
      return;
    }
    if (view === "vendor" && !statement?.supplier?.id) {
      setPayError("Select a vendor first.");
      return;
    }
    if (!statement) {
      setPayError("Run the statement first.");
      return;
    }
    const amount = Number(payAmount);
    if (!(amount > 0)) {
      setPayError("Enter a payment amount.");
      return;
    }
    const outstanding = Number(statement.payableStats.outstanding || 0);
    if (outstanding > 0.005 && amount > outstanding + 0.05) {
      setPayError(
        `Amount is more than outstanding (${formatPkr(outstanding)}).`,
      );
      return;
    }
    if (payMethod === "bank_transfer") {
      if (
        !senderBank.trim() ||
        !senderName.trim() ||
        !senderNo.trim() ||
        !receiverBank.trim() ||
        !receiverName.trim() ||
        !receiverNo.trim()
      ) {
        setPayError("Fill the sender and the receiver bank, name, and account number.");
        return;
      }
    }
    setPaySaving(true);
    setPayError(null);
    try {
      await offlineAwareSubmit({
        mutationType: "cash_payment",
        companyId,
        organizationId,
        payload: {
          organization_id: organizationId,
          company_id: companyId,
          voucher_date: payDate,
          payment_method: payMethod,
          sender_bank_name: payMethod === "bank_transfer" ? senderBank.trim() : null,
          sender_account_name: payMethod === "bank_transfer" ? senderName.trim() : null,
          sender_account_no: payMethod === "bank_transfer" ? senderNo.trim() : null,
          receiver_bank_name:
            payMethod === "bank_transfer" ? receiverBank.trim() : null,
          receiver_account_name:
            payMethod === "bank_transfer" ? receiverName.trim() : null,
          receiver_account_no: payMethod === "bank_transfer" ? receiverNo.trim() : null,
          warehouse_id: payWarehouse,
          amount,
          narration:
            payRemarks.trim() ||
            `Payment for ${
              statement.linkedCompanies?.find((c) => c.id === payWarehouse)
                ?.name || statement.warehouseName
            }`,
          lines: statement.supplier?.id
            ? [
                {
                  party_id: statement.supplier.id,
                  amount,
                  narration:
                    payRemarks.trim() ||
                    `${statement.warehouseName} · ${paymentMethodLabel(payMethod)}`,
                },
              ]
            : [],
        },
      });
      setPayOpen(false);
      setPayAmount("");
      setPayRemarks("");
      setPayMethod("cash");
      setSenderBank("");
      setSenderName("");
      setSenderNo("");
      setReceiverBank("");
      setReceiverName("");
      setReceiverNo("");
      setPayDate(localDateIso());
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      setPayError(err?.message || String(err));
    } finally {
      setPaySaving(false);
    }
  }

  return (
    <div className="animate-rise space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          Company statement
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Stock, purchases, sales, and vendor payments — {companyName}. Run by
          one company, or by a vendor to include every company linked to that
          vendor.
        </p>
      </div>

      <UrlFilterForm
        key={`${view}|${warehouseId}|${vendorIdParam}|${from}|${to}|${methodFilter}`}
        className="panel no-print flex flex-wrap items-end gap-3 p-4"
      >
        <div className="w-40 max-w-full shrink-0">
          <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
            View
          </label>
          <Select
            name="view"
            value={viewDraft}
            onChange={(e) =>
              setViewDraft(e.target.value === "vendor" ? "vendor" : "company")
            }
            options={[
              { value: "company", label: "Company wise" },
              { value: "vendor", label: "Vendor wise" },
            ]}
          />
        </div>
        <div className="w-72 max-w-full shrink-0">
          <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
            {viewDraft === "vendor" ? "Vendor" : "Company"}
          </label>
          {viewDraft === "vendor" ? (
            <Select
              name="vendor"
              defaultValue={vendorIdParam}
              maxVisible={10000}
              options={[
                { value: "", label: "Select vendor" },
                ...suppliers,
              ]}
            />
          ) : (
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
          )}
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
        <div className="w-44 max-w-full">
          <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
            Payment method
          </label>
          <Select
            name="method"
            defaultValue={methodFilter}
            options={[
              { value: "", label: "All methods" },
              { value: "cash", label: "Cash" },
              { value: "bank_transfer", label: "Bank transfer" },
              { value: "other", label: "Other" },
            ]}
          />
        </div>
        <ReportFilterActions submitLabel="Run statement" nowrap className="shrink-0" />
      </UrlFilterForm>

      {view === "company" && !warehouseId ? (
        <p className="text-sm text-[var(--muted)]">
          Select a company and a date range.
        </p>
      ) : view === "vendor" && !vendorIdParam ? (
        <p className="text-sm text-[var(--muted)]">
          Select a vendor and a date range.
        </p>
      ) : loading ? (
        <p className="text-sm text-[var(--muted)]">
          Reading stock, purchases, sales, and payments…
        </p>
      ) : error ? (
        <p className="text-sm text-[var(--danger)]">{error}</p>
      ) : statement ? (
        <>
          <div className="panel no-print flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                {view === "vendor" ? "Linked companies" : "Linked vendor"}
              </p>
              <p className="mt-1 text-sm font-medium text-[var(--ink)]">
                {view === "vendor"
                  ? statement.linkedCompanies?.length
                    ? statement.linkedCompanies.map((c) => c.name).join(", ")
                    : "No companies linked to this vendor yet"
                  : statement.supplier
                    ? `${statement.supplier.party_code} — ${statement.supplier.name_en}`
                    : "No vendor linked yet"}
              </p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {view === "vendor"
                  ? "Purchases, stock, and payments below are only for companies that selected this vendor."
                  : statement.supplier
                    ? `Payments for ${statement.warehouseName} post to this supplier ledger.`
                    : `Payments for ${statement.warehouseName} stay on this company. Linking a vendor is optional.`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {view === "company" ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setVendorError(null);
                  setVendorOpen(true);
                }}
              >
                {statement.supplier ? "Change vendor" : "Link vendor"}
              </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                disabled={
                  view === "vendor" && !statement.linkedCompanies?.length
                }
                title={
                  view === "vendor" && !statement.linkedCompanies?.length
                    ? "Link this vendor on a company first"
                    : undefined
                }
                onClick={() => {
                  setPayError(null);
                  setPayDate(to || localDateIso());
                  setPayOpen(true);
                }}
              >
                Record payment
              </Button>
            </div>
          </div>

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
              value={
                statement.supplier
                  ? statement.payableStats.purchases
                  : statement.purchaseAmount
              }
              format="money"
              icon={Truck}
              hint={`Qty in ${statement.purchaseQty}`}
            />
            <StatCard
              label="Paid to vendor"
              value={statement.payableStats.paid}
              format="money"
              icon={Banknote}
              tone="ok"
              hint={`${from} to ${to}`}
            />
            <StatCard
              label="Outstanding"
              value={statement.payableStats.outstanding}
              format="money"
              icon={Wallet}
              tone={
                statement.payableStats.outstanding > 0.005 ? "warn" : "ok"
              }
              hint="As of selected To date"
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
            title={`${statement.warehouseName} — payable ledger`}
            companyName={companyName}
            subtitle={`Vendor payments and purchases for this company · ${from} to ${to}.${
              usingLocal
                ? " Offline copy — brand-tagged payments need online sync to appear."
                : ""
            }${
              methodFilter
                ? ` · Filter: ${paymentMethodLabel(methodFilter)}`
                : ""
            }`}
            rows={payableRows}
            filename={`company-payable-${statement.warehouseName}`}
            showFooter={false}
          />

          <ReportTable
            title={`${statement.warehouseName} — summary`}
            companyName={companyName}
            subtitle={`${from} to ${to}. Purchase amount is the purchase invoice total for this company's products.${
              usingLocal
                ? " Figures are from the books saved on this computer."
                : ""
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

      <Dialog
        open={vendorOpen}
        onClose={() => setVendorOpen(false)}
        title="Link vendor"
        description={`Choose the supplier payable for ${statement?.warehouseName || "this company"}.`}
      >
        <form onSubmit={saveVendor} className="space-y-4">
          <div>
            <Label>Vendor</Label>
            <Select
              value={vendorId}
              maxVisible={10000}
              onChange={(e) => setVendorId(e.target.value)}
              options={[
                { value: "", label: "No vendor (clear)" },
                ...suppliers,
              ]}
            />
          </div>
          {vendorError ? (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {vendorError}
            </p>
          ) : null}
          <Button type="submit" loading={vendorSaving}>
            Save vendor
          </Button>
        </form>
      </Dialog>

      <Dialog
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="Record payment"
        description={
          statement?.supplier
            ? `Pay ${statement.supplier.party_code} — ${statement.supplier.name_en} for ${statement.warehouseName}. Outstanding ${formatPkr(statement.payableStats.outstanding)}.`
            : `Payment for ${statement?.warehouseName || "this company"}. Outstanding ${formatPkr(statement?.payableStats.outstanding || 0)}.`
        }
      >
        <form onSubmit={savePayment} className="space-y-4">
          {view === "vendor" && (statement?.linkedCompanies?.length || 0) > 1 ? (
            <div>
              <Label>Company</Label>
              <Select
                value={payWarehouseId}
                onChange={(e) => setPayWarehouseId(e.target.value)}
                options={(statement?.linkedCompanies || []).map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
              />
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Method</Label>
              <Select
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
                options={[
                  { value: "cash", label: "Cash" },
                  { value: "bank_transfer", label: "Bank transfer" },
                  { value: "other", label: "Other" },
                ]}
              />
            </div>
          </div>
          {payMethod === "bank_transfer" ? (
            <BankPaymentFields
              companyId={companyId}
              organizationId={organizationId}
              senderBank={senderBank}
              senderName={senderName}
              senderNo={senderNo}
              receiverBank={receiverBank}
              receiverName={receiverName}
              receiverNo={receiverNo}
              onSenderBank={setSenderBank}
              onSenderName={setSenderName}
              onSenderNo={setSenderNo}
              onReceiverBank={setReceiverBank}
              onReceiverName={setReceiverName}
              onReceiverNo={setReceiverNo}
            />
          ) : null}
          <div>
            <Label>Amount</Label>
            <Input
              type="number"
              min="0"
              step={AMOUNT_STEP}
              placeholder={AMOUNT_PLACEHOLDER}
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              required
            />
          </div>
          <div>
            <Label>Remarks</Label>
            <Input
              value={payRemarks}
              onChange={(e) => setPayRemarks(e.target.value)}
              placeholder="Optional note"
            />
          </div>
          {payError ? (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {payError}
            </p>
          ) : null}
          <Button type="submit" loading={paySaving}>
            Save payment
          </Button>
        </form>
      </Dialog>
    </div>
  );
}

"use client";

import { PartyCodePicker } from "@/components/forms/party-code-picker";
import {
  LineItemsEditor,
  summarizeLines,
  type LineItemsEditorHandle,
} from "@/components/trading/line-items-editor";
import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import { getCachedRows } from "@/lib/offline/local-db";
import { offlineAwareSubmit } from "@/lib/offline/offline-submit";
import type { Party, Product, Warehouse } from "@/lib/types/database";
import { useSingleSubmit } from "@/lib/forms/single-submit";
import { useDialogInvoiceNo } from "@/lib/trading/preview-document-no";
import { type LineItemDraft, calcLineDiscount } from "@/lib/types/trading";
import { createClient } from "@/lib/supabase/client";
import { loadWarehousePayableOutstanding } from "@/lib/reports/company-statement";
import { formatPkr } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type BuyFrom = "vendor" | "company";

type GatePassOption = {
  id: string;
  pass_no: string;
  pass_date: string;
  warehouse_id: string | null;
  party_id: string | null;
  /** Stock company (warehouse) name — shown on the right in the picker. */
  company_name: string;
};

export type PurchaseInvoiceEdit = {
  id: string;
  invoiceNo: string;
  partyId: string;
  warehouseId: string;
  invoiceDate: string;
  supplierBillNo: string;
  companyInvoiceDate?: string;
  gatePassId?: string;
  buyFrom?: BuyFrom;
  narration: string;
  extraDiscount: string;
  amountDifference?: string;
  lines: LineItemDraft[];
};

export function PurchaseInvoiceForm({
  companyId,
  organizationId,
  parties,
  products,
  warehouses,
  editing,
  onDone,
}: {
  companyId: string;
  organizationId: string;
  parties: Party[];
  products: Product[];
  warehouses: Warehouse[];
  editing?: PurchaseInvoiceEdit;
  onDone?: () => void;
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  useDialogInvoiceNo(companyId, "purchase_invoice", editing?.invoiceNo);
  const linesEditorRef = useRef<LineItemsEditorHandle>(null);
  const suppliers = useMemo(
    () =>
      parties.filter(
        (p) => p.party_subtype === "supplier" || p.party_subtype === "both",
      ),
    [parties],
  );

  const [buyFrom, setBuyFrom] = useState<BuyFrom>(() => {
    if (editing?.buyFrom) return editing.buyFrom;
    if (!editing) return "company";
    const linked = warehouses.find((w) => w.id === editing.warehouseId)
      ?.default_supplier_id;
    if (editing.partyId && linked && editing.partyId === linked) return "company";
    if (editing.partyId) return "vendor";
    return "company";
  });
  const [partyId, setPartyId] = useState(editing?.partyId || "");
  const [warehouseId, setWarehouseId] = useState(
    // New bills start blank — do not auto-pick the first company (e.g. Amelia).
    editing?.warehouseId || "",
  );

  const [invoiceDate, setInvoiceDate] = useState(
    editing?.invoiceDate || new Date().toISOString().slice(0, 10),
  );
  const [supplierBillNo, setSupplierBillNo] = useState(editing?.supplierBillNo || "");
  const [companyInvoiceDate, setCompanyInvoiceDate] = useState(
    editing?.companyInvoiceDate || "",
  );
  const [gatePassId, setGatePassId] = useState(editing?.gatePassId || "");
  const [gatePasses, setGatePasses] = useState<GatePassOption[]>([]);
  const [narration, setNarration] = useState(editing?.narration || "");
  const [extraDiscount, setExtraDiscount] = useState(editing?.extraDiscount || "");
  const [amountDifference, setAmountDifference] = useState(
    editing?.amountDifference || "",
  );
  const [lines, setLines] = useState<LineItemDraft[]>(editing?.lines || []);
  const [loading, setLoading] = useState(false);
  const singleSubmit = useSingleSubmit();
  const [error, setError] = useState<string | null>(null);
  const [companyBalance, setCompanyBalance] = useState<number | null>(null);

  function changeWarehouse(nextId: string) {
    setWarehouseId(nextId);
    if (!nextId) {
      setCompanyBalance(null);
      setLines([]);
      return;
    }
    setLines((prev) =>
      prev.filter((line) => {
        if (!line.product_id) return true;
        const product = products.find((p) => p.id === line.product_id);
        return product?.default_warehouse_id === nextId;
      }),
    );
  }

  useEffect(() => {
    let cancelled = false;
    async function loadBalance(whId: string) {
      if (!whId) {
        setCompanyBalance(null);
        return;
      }
      try {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          const { loadOfflineWarehousePayableOutstanding } = await import(
            "@/lib/reports/company-statement-offline"
          );
          const bal = await loadOfflineWarehousePayableOutstanding({
            companyId,
            warehouseId: whId,
            asOf: invoiceDate,
          });
          if (!cancelled) setCompanyBalance(bal);
          return;
        }
        const supabase = createClient();
        const result = await Promise.race([
          loadWarehousePayableOutstanding(supabase, {
            companyId,
            warehouseId: whId,
            asOf: invoiceDate,
          }),
          new Promise<null>((r) => setTimeout(() => r(null), 5000)),
        ]);
        if (!cancelled) {
          setCompanyBalance(result == null ? null : Number(result));
        }
      } catch {
        if (!cancelled) setCompanyBalance(null);
      }
    }
    void loadBalance(warehouseId);
    return () => {
      cancelled = true;
    };
  }, [companyId, warehouseId, invoiceDate]);

  const companyBalanceBox = (
    <div className="w-[9.5rem] shrink-0">
      <Label>Prev. balance</Label>
      <div className="flex h-10 items-center rounded-md border border-[var(--border)] bg-[var(--surface-2,#f8f8f8)] px-2 text-sm tabular-nums">
        {warehouseId ? (
          companyBalance != null ? (
            <span className="font-semibold text-[var(--ink)]">
              {formatPkr(Math.abs(companyBalance))}{" "}
              {companyBalance > 0.005
                ? "Cr"
                : companyBalance < -0.005
                  ? "Dr"
                  : "Nil"}
            </span>
          ) : (
            <span className="text-[var(--muted)]">…</span>
          )
        ) : (
          <span className="text-[var(--muted)]">—</span>
        )}
      </div>
    </div>
  );

  useEffect(() => {
    let cancelled = false;
    async function loadGatePasses() {
      const rows: GatePassOption[] = [];
      const seen = new Set<string>();

      function warehouseName(row: Record<string, unknown>, warehouseId: string | null) {
        const nested = row.warehouses;
        if (nested && typeof nested === "object" && !Array.isArray(nested)) {
          const name = String((nested as { name?: unknown }).name || "").trim();
          if (name) return name;
        }
        if (Array.isArray(nested) && nested[0] && typeof nested[0] === "object") {
          const name = String((nested[0] as { name?: unknown }).name || "").trim();
          if (name) return name;
        }
        if (warehouseId) {
          const wh = warehouses.find((w) => w.id === warehouseId);
          if (wh?.name) return wh.name;
        }
        return "";
      }

      function push(row: Record<string, unknown>) {
        const id = String(row.id || "");
        if (!id || seen.has(id)) return;
        const status = String(row.status || "posted").toLowerCase();
        if (status && status !== "posted") return;
        seen.add(id);
        const warehouse_id = row.warehouse_id ? String(row.warehouse_id) : null;
        rows.push({
          id,
          pass_no: String(row.pass_no || ""),
          pass_date: String(row.pass_date || "").slice(0, 10),
          warehouse_id,
          party_id: row.party_id ? String(row.party_id) : null,
          company_name: warehouseName(row, warehouse_id),
        });
      }

      try {
        if (typeof navigator === "undefined" || navigator.onLine) {
          const supabase = createClient();
          const { data } = await supabase
            .from("gate_passes")
            .select("id, pass_no, pass_date, warehouse_id, party_id, status, warehouses(name)")
            .eq("company_id", companyId)
            .eq("status", "posted")
            .order("pass_date", { ascending: false })
            .limit(200);
          for (const row of data || []) push(row as Record<string, unknown>);
        }
      } catch {
        /* fall through */
      }

      try {
        const cached = await getCachedRows("gate_passes", companyId);
        for (const row of cached) push(row as Record<string, unknown>);
      } catch {
        /* ignore */
      }

      if (!cancelled) {
        rows.sort((a, b) => String(b.pass_date).localeCompare(String(a.pass_date)));
        setGatePasses(rows);
      }
    }

    void loadGatePasses();
    return () => {
      cancelled = true;
    };
  }, [companyId, warehouses]);

  function applyGatePass(id: string) {
    setGatePassId(id);
    const pass = gatePasses.find((g) => g.id === id);
    if (!pass) return;
    if (pass.warehouse_id) changeWarehouse(pass.warehouse_id);
    if (pass.party_id) setPartyId(pass.party_id);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await singleSubmit(async () => {
    setError(null);
    const flushed = linesEditorRef.current?.flush() || lines;
    const valid = flushed.filter((l) => l.product_id && Number(l.qty) > 0);
    const companyVendorId =
      warehouses.find((w) => w.id === warehouseId)?.default_supplier_id || "";
    // Company mode: use linked vendor when present; vendor is optional (stock-only OK).
    const payablePartyId =
      buyFrom === "company" ? companyVendorId || partyId || "" : partyId;
    if (!warehouseId || valid.length === 0) {
      setError("Select a company and at least one product line.");
      return;
    }
    if (buyFrom === "vendor" && !payablePartyId) {
      setError("Select a vendor, a stock company, and at least one product line.");
      return;
    }

    const { subtotal, discount_total, grand_total: linesTotal } = summarizeLines(valid);
    const extra = Math.max(0, Number(extraDiscount) || 0);
    const difference = Math.max(0, Number(amountDifference) || 0);
    if (extra > linesTotal + 0.005) {
      setError("Extra discount cannot exceed the bill amount after trade discount.");
      return;
    }
    const grand_total = Math.max(0, linesTotal - extra + difference);

    setLoading(true);
    try {
      const oldNeed = new Map<string, number>();
      if (editing) {
        for (const line of editing.lines) {
          oldNeed.set(
            line.product_id,
            (oldNeed.get(line.product_id) || 0) + Number(line.qty || 0),
          );
        }
      }
      const newNeed = new Map<string, number>();
      for (const line of valid) {
        newNeed.set(
          line.product_id,
          (newNeed.get(line.product_id) || 0) + Number(line.qty || 0),
        );
      }
      const stockIds = new Set<string>([...oldNeed.keys(), ...newNeed.keys()]);
      const stockChanges = [...stockIds].map((productId) => ({
        productId,
        warehouseId,
        delta: (newNeed.get(productId) || 0) - (oldNeed.get(productId) || 0),
      }));

      const vendor =
        suppliers.find((s) => s.id === payablePartyId) ||
        parties.find((p) => p.id === payablePartyId);
      const res = await offlineAwareSubmit({
        mutationType: editing ? "purchase_invoice_update" : "purchase_invoice",
        companyId,
        organizationId,
        stockChanges,
        payload: {
          ...(editing
            ? { invoice_id: editing.id, invoice_no: editing.invoiceNo }
            : {}),
          organization_id: organizationId,
          company_id: companyId,
          invoice_date: invoiceDate,
          supplier_bill_no: supplierBillNo,
          company_invoice_date: companyInvoiceDate || null,
          gate_pass_id: gatePassId || null,
          party_id: payablePartyId || null,
          party_name: vendor?.name_en || null,
          party_code: vendor?.party_code || null,
          parties: vendor
            ? {
                name_en: vendor.name_en,
                party_code: vendor.party_code,
                phone: vendor.phone,
                mobile: vendor.mobile,
                contact_person: vendor.contact_person,
              }
            : null,
          warehouse_id: warehouseId,
          subtotal,
          discount_total,
          extra_discount: extra,
          amount_difference: difference,
          grand_total,
          narration,
          items: valid.map((l) => ({
            product_id: l.product_id,
            product_code: l.product_code,
            product_name: l.product_name,
            qty: Number(l.qty),
            rate: Number(l.rate),
            discount: calcLineDiscount(l.qty, l.rate, l.discount),
            amount: l.amount,
          })),
        },
      });

      setLoading(false);
      closeDialog?.();
      onDone?.();
      if (editing || res.source === "offline") {
        router.refresh();
      } else {
        router.push(`/purchases/invoices/${res.id}`);
        router.refresh();
      }
    } catch (err: any) {
      setLoading(false);
      setError(err?.message || String(err));
    }
    });
  }

  const vendorPicker = (
    <PartyCodePicker
      companyId={companyId}
      parties={suppliers}
      value={partyId}
      required
      label={buyFrom === "company" ? "Vendor (payable)" : "Vendor"}
      emptyLabel="Select vendor"
      filterSubtype={["supplier", "both"]}
      maxVisible={10000}
      onChange={(id) => setPartyId(id)}
    />
  );

  const linkedVendorId =
    warehouses.find((w) => w.id === warehouseId)?.default_supplier_id || "";
  const linkedVendor = parties.find((p) => p.id === linkedVendorId);
  const companyNote = !warehouseId
    ? "Pick a company. The bill is saved on that company."
    : linkedVendor
      ? `Saved on this company. Payable goes to ${linkedVendor.party_code} — ${linkedVendor.name_en}.`
      : "Saved on this company. No vendor linked — stock posts without a payable balance (or choose Buy from Vendor).";

  const companyPicker = (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <Label>{buyFrom === "company" ? "Company" : "Stock company"}</Label>
        <Select
          value={warehouseId}
          onChange={(e) => changeWarehouse(e.target.value)}
          required
        >
          <option value="">Select company</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </div>
      {companyBalanceBox}
    </div>
  );

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >
      <div className="grid items-end gap-2 sm:grid-cols-12">
        <div className="sm:col-span-2">
          <Label>Date</Label>
          <Input
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Buy from</Label>
          <Select
            value={buyFrom}
            onChange={(e) => setBuyFrom((e.target.value as BuyFrom) || "company")}
          >
            <option value="company">Company</option>
            <option value="vendor">Vendor</option>
          </Select>
        </div>
        {buyFrom === "vendor" ? (
          <>
            <div className="sm:col-span-4">{vendorPicker}</div>
            <div className="sm:col-span-4">{companyPicker}</div>
          </>
        ) : (
          <div className="sm:col-span-8">{companyPicker}</div>
        )}

        <div className="sm:col-span-3">
          <Label>Gate pass #</Label>
          <Select
            value={gatePassId}
            onChange={(e) => applyGatePass(e.target.value)}
            options={[
              { value: "", label: "Optional" },
              ...gatePasses.map((g) => ({
                value: g.id,
                label: `${g.pass_no}${g.pass_date ? ` · ${g.pass_date}` : ""}`,
                meta: g.company_name || undefined,
              })),
            ]}
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Company invoice #</Label>
          <Input
            value={supplierBillNo}
            onChange={(e) => setSupplierBillNo(e.target.value)}
            placeholder="Bill no."
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Company invoice date</Label>
          <Input
            type="date"
            value={companyInvoiceDate}
            onChange={(e) => setCompanyInvoiceDate(e.target.value)}
          />
        </div>
        <div className="sm:col-span-5">
          <Label>Narration</Label>
          <Input
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="Short note"
          />
        </div>
      </div>

      {buyFrom === "company" ? (
        <p className="text-xs text-[var(--muted)]">{companyNote}</p>
      ) : null}

      <LineItemsEditor
        ref={linesEditorRef}
        products={products}
        lines={lines}
        onChange={setLines}
        rateField="purchase_rate"
        companyId={companyId}
        partyId={partyId}
        warehouseId={warehouseId}
        warehouses={warehouses}
        filterByWarehouse
        onAutoPickWarehouse={changeWarehouse}
        extraDiscount={extraDiscount}
        onExtraDiscountChange={setExtraDiscount}
        amountDifference={amountDifference}
        onAmountDifferenceChange={setAmountDifference}
      />

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <Button type="submit" loading={loading}>
        {loading
          ? editing
            ? "Updating..."
            : "Posting..."
          : editing
            ? "Update purchase invoice"
            : "Save & post purchase invoice"}
      </Button>
    </form>
  );
}

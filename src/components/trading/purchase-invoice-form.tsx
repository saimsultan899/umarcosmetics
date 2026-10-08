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
import { type LineItemDraft, calcLineDiscount } from "@/lib/types/trading";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type BuyFrom = "vendor" | "company";

type GatePassOption = {
  id: string;
  pass_no: string;
  pass_date: string;
  warehouse_id: string | null;
  party_id: string | null;
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
  const linesEditorRef = useRef<LineItemsEditorHandle>(null);
  const suppliers = useMemo(
    () =>
      parties.filter(
        (p) =>
          p.party_subtype === "supplier" ||
          p.party_subtype === "both" ||
          p.party_type === "PARTY",
      ),
    [parties],
  );

  const [buyFrom, setBuyFrom] = useState<BuyFrom>(editing?.buyFrom || "vendor");
  const [partyId, setPartyId] = useState(editing?.partyId || "");
  const [warehouseId, setWarehouseId] = useState(
    editing?.warehouseId || warehouses[0]?.id || "",
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
  const [lines, setLines] = useState<LineItemDraft[]>(editing?.lines || []);
  const [loading, setLoading] = useState(false);
  const singleSubmit = useSingleSubmit();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadGatePasses() {
      const rows: GatePassOption[] = [];
      const seen = new Set<string>();

      function push(row: Record<string, unknown>) {
        const id = String(row.id || "");
        if (!id || seen.has(id)) return;
        seen.add(id);
        rows.push({
          id,
          pass_no: String(row.pass_no || ""),
          pass_date: String(row.pass_date || "").slice(0, 10),
          warehouse_id: row.warehouse_id ? String(row.warehouse_id) : null,
          party_id: row.party_id ? String(row.party_id) : null,
        });
      }

      try {
        if (typeof navigator === "undefined" || navigator.onLine) {
          const supabase = createClient();
          const { data } = await supabase
            .from("gate_passes")
            .select("id, pass_no, pass_date, warehouse_id, party_id, status")
            .eq("company_id", companyId)
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
  }, [companyId]);

  function applyGatePass(id: string) {
    setGatePassId(id);
    const pass = gatePasses.find((g) => g.id === id);
    if (!pass) return;
    if (pass.warehouse_id) setWarehouseId(pass.warehouse_id);
    if (pass.party_id) setPartyId(pass.party_id);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await singleSubmit(async () => {
    setError(null);
    const flushed = linesEditorRef.current?.flush() || lines;
    const valid = flushed.filter((l) => l.product_id && Number(l.qty) > 0);
    if (!partyId || !warehouseId || valid.length === 0) {
      setError(
        buyFrom === "company"
          ? "Select company, vendor (payable), and at least one product line."
          : "Select vendor, company, and at least one product line (press Enter / Add on the draft row).",
      );
      return;
    }

    const { subtotal, discount_total, grand_total: linesTotal } = summarizeLines(valid);
    const extra = Math.max(0, Number(extraDiscount) || 0);
    if (extra > linesTotal + 0.005) {
      setError("Extra discount cannot exceed the bill amount after trade discount.");
      return;
    }
    const grand_total = Math.max(0, linesTotal - extra);

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

      const vendor = suppliers.find((s) => s.id === partyId);
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
          party_id: partyId,
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
      onChange={(id) => setPartyId(id)}
    />
  );

  const companyPicker = (
    <div>
      <Label>{buyFrom === "company" ? "Company" : "Stock company"}</Label>
      <Select
        value={warehouseId}
        onChange={(e) => setWarehouseId(e.target.value)}
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
            onChange={(e) => setBuyFrom((e.target.value as BuyFrom) || "vendor")}
          >
            <option value="vendor">Vendor</option>
            <option value="company">Company</option>
          </Select>
        </div>
        {buyFrom === "vendor" ? (
          <>
            <div className="sm:col-span-5">{vendorPicker}</div>
            <div className="sm:col-span-3">{companyPicker}</div>
          </>
        ) : (
          <>
            <div className="sm:col-span-4">{companyPicker}</div>
            <div className="sm:col-span-4">{vendorPicker}</div>
          </>
        )}

        <div className="sm:col-span-3">
          <Label>Gate pass #</Label>
          <Select value={gatePassId} onChange={(e) => applyGatePass(e.target.value)}>
            <option value="">Optional</option>
            {gatePasses.map((g) => (
              <option key={g.id} value={g.id}>
                {g.pass_no}
                {g.pass_date ? ` · ${g.pass_date}` : ""}
              </option>
            ))}
          </Select>
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
        onAutoPickWarehouse={setWarehouseId}
        extraDiscount={extraDiscount}
        onExtraDiscountChange={setExtraDiscount}
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

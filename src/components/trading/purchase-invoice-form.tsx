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
import { offlineAwareSubmit } from "@/lib/offline/offline-submit";
import type { Party, Product, Warehouse } from "@/lib/types/database";
import { type LineItemDraft, calcLineDiscount } from "@/lib/types/trading";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useRef, useState } from "react";

export type PurchaseInvoiceEdit = {
  id: string;
  invoiceNo: string;
  partyId: string;
  warehouseId: string;
  invoiceDate: string;
  supplierBillNo: string;
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

  const [partyId, setPartyId] = useState(editing?.partyId || "");
  const [warehouseId, setWarehouseId] = useState(
    editing?.warehouseId || warehouses[0]?.id || "",
  );
  const [invoiceDate, setInvoiceDate] = useState(
    editing?.invoiceDate || new Date().toISOString().slice(0, 10),
  );
  const [supplierBillNo, setSupplierBillNo] = useState(editing?.supplierBillNo || "");
  const [narration, setNarration] = useState(editing?.narration || "");
  const [extraDiscount, setExtraDiscount] = useState(editing?.extraDiscount || "");
  const [lines, setLines] = useState<LineItemDraft[]>(editing?.lines || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const flushed = linesEditorRef.current?.flush() || lines;
    const valid = flushed.filter((l) => l.product_id && Number(l.qty) > 0);
    if (!partyId || !warehouseId || valid.length === 0) {
      setError(
        "Select vendor, company, and at least one product line (press Enter / Add on the draft row).",
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
  }

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
          <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
        </div>
        <div className="sm:col-span-5">
          <PartyCodePicker
            companyId={companyId}
            parties={suppliers}
            value={partyId}
            required
            label="Vendor code"
            emptyLabel="Select vendor"
            filterSubtype={["supplier", "both"]}
            onChange={(id) => setPartyId(id)}
          />
        </div>
        <div className="sm:col-span-3">
          <Label>Company</Label>
          <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label>Vendor bill #</Label>
          <Input value={supplierBillNo} onChange={(e) => setSupplierBillNo(e.target.value)} />
        </div>
        <div className="sm:col-span-12">
          <Label>Narration</Label>
          <Input value={narration} onChange={(e) => setNarration(e.target.value)} />
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

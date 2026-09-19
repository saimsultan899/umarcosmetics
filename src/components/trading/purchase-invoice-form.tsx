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

export function PurchaseInvoiceForm({
  companyId,
  organizationId,
  parties,
  products,
  warehouses,
  onDone,
}: {
  companyId: string;
  organizationId: string;
  parties: Party[];
  products: Product[];
  warehouses: Warehouse[];
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

  const [partyId, setPartyId] = useState("");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id || "");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [supplierBillNo, setSupplierBillNo] = useState("");
  const [narration, setNarration] = useState("");
  const [extraDiscount, setExtraDiscount] = useState("");
  const [lines, setLines] = useState<LineItemDraft[]>([]);
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
      const stockChanges = valid.map((l) => ({
        productId: l.product_id,
        warehouseId,
        delta: Number(l.qty),
      }));

      const vendor = suppliers.find((s) => s.id === partyId);
      const res = await offlineAwareSubmit({
        mutationType: "purchase_invoice",
        companyId,
        organizationId,
        stockChanges,
        payload: {
          organization_id: organizationId,
          company_id: companyId,
          invoice_date: invoiceDate,
          supplier_bill_no: supplierBillNo,
          party_id: partyId,
          party_name: vendor?.name_en || null,
          party_code: vendor?.party_code || null,
          parties: vendor
            ? { name_en: vendor.name_en, party_code: vendor.party_code }
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
      if (res.source === "offline") {
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
      className="space-y-5"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Date</Label>
          <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
        </div>
        <div className="sm:col-span-2 lg:col-span-2">
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
        <div>
          <Label>Company</Label>
          <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Vendor bill #</Label>
          <Input value={supplierBillNo} onChange={(e) => setSupplierBillNo(e.target.value)} />
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
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

      <Button type="submit" disabled={loading}>
        {loading ? "Posting..." : "Save & post purchase invoice"}
      </Button>
    </form>
  );
}

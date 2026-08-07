"use client";

import { PartyCodePicker } from "@/components/forms/party-code-picker";
import { LineItemsEditor, summarizeLines } from "@/components/trading/line-items-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { Party, Product, Warehouse } from "@/lib/types/database";
import { emptyLine, type LineItemDraft } from "@/lib/types/trading";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

export function PurchaseInvoiceForm({
  companyId,
  organizationId,
  parties,
  products,
  warehouses,
}: {
  companyId: string;
  organizationId: string;
  parties: Party[];
  products: Product[];
  warehouses: Warehouse[];
}) {
  const router = useRouter();
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
  const [lines, setLines] = useState<LineItemDraft[]>([emptyLine()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const valid = lines.filter((l) => l.product_id && Number(l.qty) > 0);
    if (!partyId || !warehouseId || valid.length === 0) {
      setError("Select supplier, warehouse, and at least one product line.");
      return;
    }

    const { subtotal, discount_total, grand_total } = summarizeLines(valid);
    setLoading(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_purchase_invoice", {
      p_payload: {
        organization_id: organizationId,
        company_id: companyId,
        invoice_date: invoiceDate,
        supplier_bill_no: supplierBillNo,
        party_id: partyId,
        warehouse_id: warehouseId,
        subtotal,
        discount_total,
        grand_total,
        narration,
        items: valid.map((l) => ({
          product_id: l.product_id,
          product_code: l.product_code,
          product_name: l.product_name,
          qty: Number(l.qty),
          rate: Number(l.rate),
          discount: Number(l.discount || 0),
          amount: l.amount,
        })),
      },
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.push(`/purchases/invoices/${data}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            label="Supplier code"
            filterSubtype={["supplier", "both"]}
            onChange={(id) => setPartyId(id)}
          />
        </div>
        <div>
          <Label>Warehouse</Label>
          <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Supplier bill #</Label>
          <Input value={supplierBillNo} onChange={(e) => setSupplierBillNo(e.target.value)} />
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <Label>Narration</Label>
          <Input value={narration} onChange={(e) => setNarration(e.target.value)} />
        </div>
      </div>

      <LineItemsEditor
        products={products}
        lines={lines}
        onChange={setLines}
        rateField="purchase_rate"
        companyId={companyId}
        partyId={partyId}
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

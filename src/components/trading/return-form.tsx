"use client";

import {
  LineItemsEditor,
  summarizeLines,
  type LineItemsEditorHandle,
} from "@/components/trading/line-items-editor";
import { PartyCodePicker } from "@/components/forms/party-code-picker";
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

export function ReturnForm({
  kind,
  companyId,
  organizationId,
  parties,
  products,
  warehouses,
  onDone,
}: {
  kind: "sale" | "purchase";
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
  const partyOptions = useMemo(() => {
    if (kind === "purchase") {
      return parties.filter(
        (p) =>
          p.party_subtype === "supplier" ||
          p.party_subtype === "both" ||
          p.party_type === "PARTY",
      );
    }
    return parties.filter(
      (p) =>
        p.party_subtype === "customer" ||
        p.party_subtype === "both" ||
        p.party_type === "PARTY",
    );
  }, [kind, parties]);

  const [partyId, setPartyId] = useState("");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id || "");
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10));
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
        kind === "purchase"
          ? "Select vendor, company, and at least one line (Enter/Add on the draft row)."
          : "Select customer, company, and at least one line (Enter/Add on the draft row).",
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
        delta: kind === "sale" ? Number(l.qty) : -Number(l.qty),
      }));

      const res = await offlineAwareSubmit({
        mutationType: kind === "sale" ? "sale_return" : "purchase_return",
        companyId,
        organizationId,
        stockChanges,
        payload: {
          organization_id: organizationId,
          company_id: companyId,
          return_date: returnDate,
          party_id: partyId,
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
      const basePath = kind === "sale" ? "/sales/returns" : "/purchases/returns";
      if (res.source === "offline") {
        router.refresh();
      } else {
        router.push(`${basePath}/${res.id}`);
        router.refresh();
      }
    } catch (err: unknown) {
      setLoading(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Date</Label>
          <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} required />
        </div>
        <div className="sm:col-span-2 lg:col-span-2">
          <PartyCodePicker
            companyId={companyId}
            parties={partyOptions}
            value={partyId}
            required
            label={kind === "purchase" ? "Vendor code" : "Customer code"}
            emptyLabel={kind === "purchase" ? "Select vendor" : "Select customer"}
            filterSubtype={
              kind === "purchase" ? ["supplier", "both"] : ["customer", "both"]
            }
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
        rateField={kind === "sale" ? "sale_rate" : "purchase_rate"}
        companyId={companyId}
        partyId={partyId}
        extraDiscount={extraDiscount}
        onExtraDiscountChange={setExtraDiscount}
      />

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <Button type="submit" disabled={loading}>
        {loading ? "Posting..." : `Save & post ${kind} return`}
      </Button>
    </form>
  );
}

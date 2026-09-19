"use client";

import {
  ProductQtyLinesEditor,
  type ProductQtyLine,
  type ProductQtyLinesEditorHandle,
} from "@/components/trading/product-qty-lines-editor";
import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import { offlineAwareSubmit } from "@/lib/offline/offline-submit";
import type { Product, Warehouse } from "@/lib/types/database";
import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";

export function StockTransferForm({
  companyId,
  organizationId,
  products,
  warehouses,
  onDone,
}: {
  companyId: string;
  organizationId: string;
  products: Product[];
  warehouses: Warehouse[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  const linesEditorRef = useRef<ProductQtyLinesEditorHandle>(null);
  const [fromId, setFromId] = useState(warehouses[0]?.id || "");
  const [toId, setToId] = useState(warehouses[1]?.id || warehouses[0]?.id || "");
  const [transferDate, setTransferDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<ProductQtyLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const flushed = linesEditorRef.current?.flush() || lines;
    const valid = flushed.filter((l) => l.product_id && Number(l.qty) > 0);
    if (!fromId || !toId || fromId === toId || valid.length === 0) {
      setError(
        "Choose different companies and at least one product (Enter on qty to add the line).",
      );
      return;
    }

    setLoading(true);
    try {
      const stockChanges: Array<{ productId: string; warehouseId: string; delta: number }> = [];
      for (const l of valid) {
        stockChanges.push({
          productId: l.product_id,
          warehouseId: fromId,
          delta: -Number(l.qty),
        });
        stockChanges.push({
          productId: l.product_id,
          warehouseId: toId,
          delta: Number(l.qty),
        });
      }

      const res = await offlineAwareSubmit({
        mutationType: "stock_transfer",
        companyId,
        organizationId,
        stockChanges,
        payload: {
          organization_id: organizationId,
          company_id: companyId,
          transfer_date: transferDate,
          from_warehouse_id: fromId,
          to_warehouse_id: toId,
          narration,
          items: valid.map((l) => ({
            product_id: l.product_id,
            product_code: l.product_code,
            product_name: l.product_name,
            qty: Number(l.qty),
          })),
        },
      });

      setLoading(false);
      closeDialog?.();
      onDone?.();
      if (res.source === "offline") {
        router.refresh();
      } else {
        router.push(`/warehouses/transfers/${res.id}`);
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
          <Input
            type="date"
            value={transferDate}
            onChange={(e) => setTransferDate(e.target.value)}
          />
        </div>
        <div>
          <Label>Company from</Label>
          <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Company to</Label>
          <Select value={toId} onChange={(e) => setToId(e.target.value)}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Narration</Label>
          <Input
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
          />
        </div>
      </div>

      <ProductQtyLinesEditor
        ref={linesEditorRef}
        products={products}
        lines={lines}
        onChange={setLines}
      />

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <div>
        <Button type="submit" disabled={loading}>
          {loading ? "Transferring..." : "Save company transfer"}
        </Button>
      </div>
    </form>
  );
}

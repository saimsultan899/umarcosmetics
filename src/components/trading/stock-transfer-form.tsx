"use client";

import {
  ProductQtyLinesEditor,
  type ProductQtyLine,
} from "@/components/trading/product-qty-lines-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import { createClient } from "@/lib/supabase/client";
import type { Product, Warehouse } from "@/lib/types/database";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function StockTransferForm({
  companyId,
  organizationId,
  products,
  warehouses,
}: {
  companyId: string;
  organizationId: string;
  products: Product[];
  warehouses: Warehouse[];
}) {
  const router = useRouter();
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
    const valid = lines.filter((l) => l.product_id && Number(l.qty) > 0);
    if (!fromId || !toId || fromId === toId || valid.length === 0) {
      setError("Choose different warehouses and at least one product.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_stock_transfer", {
      p_payload: {
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
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.push(`/warehouses/transfers/${data}`);
    router.refresh();
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
          <Label>Warehouse From</Label>
          <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Warehouse To</Label>
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
        products={products}
        lines={lines}
        onChange={setLines}
      />

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <div>
        <Button type="submit" disabled={loading}>
          {loading ? "Transferring..." : "Save warehouse transfer"}
        </Button>
      </div>
    </form>
  );
}

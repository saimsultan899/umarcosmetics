"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { SaleOrderDetail } from "@/lib/sales/sale-orders";
import { formatPkr } from "@/lib/utils";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

type PartyOption = { id: string; party_code: string; name_en: string };
type ProductOption = {
  id: string;
  code: string | null;
  name_en: string;
  sale_rate: number | null;
  retail_rate: number | null;
  default_warehouse_id: string | null;
};

type EditLine = {
  key: string;
  id?: string;
  product_id: string;
  product_code: string;
  product_name: string;
  qty: string;
  rate: number;
  locked: boolean;
};

function tradePrice(product: ProductOption) {
  const sale = Number(product.sale_rate || 0);
  if (sale > 0) return sale;
  return Number(product.retail_rate || 0);
}

export function SaleOrderEditForm({
  order,
  parties,
  products,
  onDone,
}: {
  order: SaleOrderDetail;
  parties: PartyOption[];
  products: ProductOption[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const openLines = order.lines.filter((line) => line.status === "open");
  const billedLines = order.lines.filter((line) => line.status === "fulfilled");
  const [partyId, setPartyId] = useState(order.partyId);
  const [orderDate, setOrderDate] = useState(order.orderDate.slice(0, 10));
  const [note, setNote] = useState(order.note || "");
  const [lines, setLines] = useState<EditLine[]>(() =>
    openLines.map((line) => ({
      key: line.id,
      id: line.id,
      product_id: line.product_id,
      product_code: line.product_code || "",
      product_name: line.product_name || "",
      qty: String(line.qty),
      rate: line.rate,
      locked: false,
    })),
  );
  const [draftProductId, setDraftProductId] = useState("");
  const [draftQty, setDraftQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const qty = Number(line.qty || 0);
        return sum + Math.round(qty * line.rate * 100) / 100;
      }, 0),
    [lines],
  );

  function addLine() {
    const product = products.find((row) => row.id === draftProductId);
    if (!product || !product.default_warehouse_id) {
      setError("Select a product with a company");
      return;
    }
    const qty = Number(draftQty || 0);
    if (qty <= 0) {
      setError("Enter a quantity");
      return;
    }
    const rate = tradePrice(product);
    setLines((current) => [
      ...current,
      {
        key: `new-${product.id}-${Date.now()}`,
        product_id: product.id,
        product_code: product.code || "",
        product_name: product.name_en,
        qty: String(qty),
        rate,
        locked: false,
      },
    ]);
    setDraftProductId("");
    setDraftQty("1");
    setError(null);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (lines.length === 0 && billedLines.length === 0) {
      setError("Add at least one product");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await createClient().rpc("update_sale_order", {
        p_payload: {
          id: order.id,
          party_id: partyId,
          order_date: orderDate,
          note,
          keep_line_ids: lines.filter((line) => line.id).map((line) => line.id),
          lines: lines.map((line) => ({
            id: line.id || null,
            product_id: line.product_id,
            qty: Number(line.qty || 0),
          })),
        },
      });
      if (rpcError) throw new Error(rpcError.message);
      onDone?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the order");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {billedLines.length ? (
        <p className="rounded-[var(--radius)] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {billedLines.length} line
          {billedLines.length === 1 ? "" : "s"} already billed and stay locked.
          You can still change the waiting companies below.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Customer</Label>
          <Select
            value={partyId}
            onChange={(event) => setPartyId(event.target.value)}
            required
          >
            {parties.map((party) => (
              <option key={party.id} value={party.id}>
                {party.party_code} {party.name_en}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Order date</Label>
          <Input
            type="date"
            value={orderDate}
            onChange={(event) => setOrderDate(event.target.value)}
            required
          />
        </div>
      </div>

      <div>
        <Label>Note</Label>
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional note for the office"
        />
      </div>

      <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--surface-2)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">TP</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const qty = Number(line.qty || 0);
              const amount = Math.round(qty * line.rate * 100) / 100;
              return (
                <tr key={line.key} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2">
                    <p className="font-medium">{line.product_name}</p>
                    <p className="text-xs text-[var(--muted)]">{line.product_code || "—"}</p>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      className="ml-auto h-9 w-20 text-right"
                      value={line.qty}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((row) =>
                            row.key === line.key
                              ? { ...row, qty: event.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2 text-right">{formatPkr(line.rate)}</td>
                  <td className="px-3 py-2 text-right">{formatPkr(amount)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        setLines((current) =>
                          current.filter((row) => row.key !== line.key),
                        )
                      }
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-rose-600 hover:bg-rose-50"
                      aria-label="Remove line"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {lines.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-[var(--muted)]">
                  No open lines left. Add a product below.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_6rem_auto]">
        <Select
          value={draftProductId}
          onChange={(event) => setDraftProductId(event.target.value)}
        >
          <option value="">Add product</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.code ? `${product.code} · ` : ""}
              {product.name_en}
            </option>
          ))}
        </Select>
        <Input
          value={draftQty}
          onChange={(event) => setDraftQty(event.target.value)}
          placeholder="Qty"
        />
        <Button type="button" variant="secondary" onClick={addLine}>
          Add
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">Waiting total {formatPkr(total)}</p>
        <Button type="submit" loading={busy}>
          {busy ? "Saving…" : "Save order"}
        </Button>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}

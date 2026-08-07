"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { Product, Warehouse } from "@/lib/types/database";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useRef, useState } from "react";

type TransferLine = {
  key: string;
  product_id: string;
  product_code: string;
  product_name: string;
  qty: string;
};

function emptyTransferLine(): TransferLine {
  return {
    key: crypto.randomUUID(),
    product_id: "",
    product_code: "",
    product_name: "",
    qty: "1",
  };
}

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
  const [lines, setLines] = useState<TransferLine[]>([emptyTransferLine()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function applyProduct(key: string, p: Product | null) {
    setLines((prev) =>
      prev.map((l) =>
        l.key === key
          ? {
              ...l,
              product_id: p?.id || "",
              product_code: p?.code || "",
              product_name: p?.name_en || "",
              qty: Number(l.qty) > 0 ? l.qty : "1",
            }
          : l,
      ),
    );
  }

  function pickProduct(key: string, productId: string) {
    applyProduct(key, products.find((x) => x.id === productId) || null);
  }

  function resolveCode(key: string, raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      applyProduct(key, null);
      return;
    }
    const local = products.find(
      (p) => p.code.toLowerCase() === trimmed.toLowerCase(),
    );
    if (local) applyProduct(key, local);
    else {
      setLines((prev) =>
        prev.map((l) =>
          l.key === key ? { ...l, product_code: trimmed } : l,
        ),
      );
    }
  }

  function queueCode(key: string, value: string) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, product_code: value } : l)),
    );
    if (codeTimers.current[key]) clearTimeout(codeTimers.current[key]);
    codeTimers.current[key] = setTimeout(() => resolveCode(key, value), 350);
  }

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

  const productOptions = useMemo(
    () => [
      { value: "", label: "Select product" },
      ...products.map((p) => ({
        value: p.id,
        label: `${p.code} — ${p.name_en}`,
      })),
    ],
    [products],
  );

  return (
    <form onSubmit={onSubmit} className="space-y-5">
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

      <div className="table-grid">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr>
              <th className="w-24">Code</th>
              <th>Product</th>
              <th className="w-32">Qty</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">
                  <Input
                    value={line.product_code}
                    placeholder="Code"
                    onChange={(e) => queueCode(line.key, e.target.value)}
                    onBlur={() => resolveCode(line.key, line.product_code)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        resolveCode(line.key, line.product_code);
                      }
                    }}
                  />
                </td>
                <td className="px-3 py-2">
                  <Select
                    size="sm"
                    value={line.product_id}
                    options={productOptions}
                    onChange={(e) => pickProduct(line.key, e.target.value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={line.qty}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l) =>
                          l.key === line.key ? { ...l, qty: e.target.value } : l,
                        ),
                      )
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="rounded-lg p-2 text-rose-600 hover:bg-rose-50"
                    onClick={() =>
                      setLines((prev) =>
                        prev.length <= 1
                          ? [emptyTransferLine()]
                          : prev.filter((l) => l.key !== line.key),
                      )
                    }
                    aria-label="Remove line"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setLines((prev) => [...prev, emptyTransferLine()])}
      >
        <Plus className="h-4 w-4" />
        Add line
      </Button>

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

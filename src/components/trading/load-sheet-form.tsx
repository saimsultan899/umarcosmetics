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

type Line = {
  key: string;
  product_id: string;
  product_code: string;
  product_name: string;
  qty: string;
};

type SalesmanOpt = { user_id: string; full_name: string | null };

function empty(): Line {
  return {
    key: crypto.randomUUID(),
    product_id: "",
    product_code: "",
    product_name: "",
    qty: "1",
  };
}

export function LoadSheetForm({
  companyId,
  organizationId,
  products,
  warehouses,
  salesmen,
}: {
  companyId: string;
  organizationId: string;
  products: Product[];
  warehouses: Warehouse[];
  salesmen: SalesmanOpt[];
}) {
  const router = useRouter();
  const [sheetDate, setSheetDate] = useState(new Date().toISOString().slice(0, 10));
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id || "");
  const [salesmanId, setSalesmanId] = useState(salesmen[0]?.user_id || "");
  const [vehicleNo, setVehicleNo] = useState("");
  const [route, setRoute] = useState("");
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<Line[]>([empty()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function applyProduct(key: string, p: Product | null) {
    setLines((prev) =>
      prev.map((l) =>
        l.key !== key
          ? l
          : {
              ...l,
              product_id: p?.id || "",
              product_code: p?.code || "",
              product_name: p?.name_en || "",
              qty: Number(l.qty) > 0 ? l.qty : "1",
            },
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
    if (!warehouseId || valid.length === 0) {
      setError("Select warehouse and at least one product.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_load_sheet", {
      p_payload: {
        organization_id: organizationId,
        company_id: companyId,
        sheet_date: sheetDate,
        warehouse_id: warehouseId,
        salesman_id: salesmanId || null,
        vehicle_no: vehicleNo,
        route,
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

    router.push(`/inventory/load-sheets/${data}`);
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label>Date</Label>
          <Input
            type="date"
            value={sheetDate}
            onChange={(e) => setSheetDate(e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Load from warehouse</Label>
          <Select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            required
          >
            <option value="">Select warehouse</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Salesman</Label>
          <Select value={salesmanId} onChange={(e) => setSalesmanId(e.target.value)}>
            <option value="">Optional</option>
            {salesmen.map((s) => (
              <option key={s.user_id} value={s.user_id}>
                {s.full_name || s.user_id.slice(0, 8)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Vehicle no</Label>
          <Input
            value={vehicleNo}
            onChange={(e) => setVehicleNo(e.target.value)}
            placeholder="LES-1234"
          />
        </div>
        <div>
          <Label>Route / market</Label>
          <Input
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            placeholder="City / beat"
          />
        </div>
        <div>
          <Label>Notes</Label>
          <Input
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>

      <div className="table-grid">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="bg-[var(--surface-2)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
              <th className="px-3 py-2 w-24">Code</th>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2 w-28">Qty</th>
              <th className="px-3 py-2 w-12" />
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
                    className="rounded-lg p-2 text-[var(--muted)] hover:bg-rose-50 hover:text-rose-700"
                    onClick={() =>
                      setLines((prev) =>
                        prev.length === 1
                          ? [empty()]
                          : prev.filter((l) => l.key !== line.key),
                      )
                    }
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
        onClick={() => setLines((prev) => [...prev, empty()])}
      >
        <Plus className="h-4 w-4" />
        Add line
      </Button>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <Button type="submit" disabled={loading}>
        {loading ? "Posting load sheet..." : "Issue van load & deduct stock"}
      </Button>
    </form>
  );
}

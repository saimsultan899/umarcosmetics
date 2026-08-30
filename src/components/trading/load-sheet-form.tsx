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

type SalesmanOpt = { user_id: string; full_name: string | null };

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
  const [lines, setLines] = useState<ProductQtyLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const valid = lines.filter((l) => l.product_id && Number(l.qty) > 0);
    if (!warehouseId || valid.length === 0) {
      setError("Select company and at least one product.");
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

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >
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
          <Label>Load from company</Label>
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
          <Label>Sector / market</Label>
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

      <ProductQtyLinesEditor
        products={products}
        lines={lines}
        onChange={setLines}
      />

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <Button type="submit" disabled={loading}>
        {loading ? "Posting load sheet..." : "Issue van load & deduct stock"}
      </Button>
    </form>
  );
}

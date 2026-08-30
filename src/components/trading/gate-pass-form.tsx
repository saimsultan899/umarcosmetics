"use client";

import { PartyCodePicker } from "@/components/forms/party-code-picker";
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
import type { Party, Product, Warehouse } from "@/lib/types/database";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

export function GatePassForm({
  companyId,
  organizationId,
  companyName,
  companyCity,
  companyNtn,
  parties,
  products,
  warehouses,
}: {
  companyId: string;
  organizationId: string;
  companyName: string;
  companyCity?: string | null;
  companyNtn?: string | null;
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

  const brandOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of products) {
      const v = (p.manufacturer || "").trim();
      if (!v) continue;
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [products]);

  const [passDate, setPassDate] = useState(new Date().toISOString().slice(0, 10));
  const [partyId, setPartyId] = useState("");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id || "");
  const [manufacturer, setManufacturer] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [transporter, setTransporter] = useState("");
  const [poNo, setPoNo] = useState("");
  const [biltyNo, setBiltyNo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<ProductQtyLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catalog = useMemo(() => {
    if (!manufacturer) return products;
    return products.filter(
      (p) =>
        (p.manufacturer || "").trim().toLowerCase() ===
        manufacturer.trim().toLowerCase(),
    );
  }, [products, manufacturer]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const valid = lines.filter((l) => l.product_id && Number(l.qty) > 0);
    if (valid.length === 0) {
      setError("Add at least one existing product with quantity.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_gate_pass", {
      p_payload: {
        organization_id: organizationId,
        company_id: companyId,
        pass_date: passDate,
        party_id: partyId || null,
        warehouse_id: warehouseId || null,
        manufacturer,
        vehicle_no: vehicleNo,
        transporter,
        po_no: poNo,
        bilty_no: biltyNo,
        remarks,
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

    router.push(`/purchases/gate-passes/${data}`);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >
      <div className="rounded-xl border border-[var(--brand)]/25 bg-[var(--brand-soft)]/50 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Gate pass company
        </p>
        <p className="font-[family-name:var(--font-display)] text-lg font-semibold">
          {companyName}
        </p>
        <p className="text-xs text-[var(--muted)]">
          {[companyCity, companyNtn ? `NTN ${companyNtn}` : ""]
            .filter(Boolean)
            .join(" · ") || "Switch company from the header to print for another account."}
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          This sheet is for matching the incoming load only. It does not add stock —
          post a purchase invoice after you verify the goods.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Date</Label>
          <Input
            type="date"
            value={passDate}
            onChange={(e) => setPassDate(e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Receive at company</Label>
          <Select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
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
          <Label>Brand / company load</Label>
          <Select
            value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)}
          >
            <option value="">All products</option>
            {brandOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <PartyCodePicker
            companyId={companyId}
            parties={suppliers}
            value={partyId}
            label="Vendor (existing)"
            emptyLabel="Select vendor"
            filterSubtype={["supplier", "both"]}
            onChange={(id) => setPartyId(id)}
          />
        </div>
        <div>
          <Label>Vehicle no</Label>
          <Input
            value={vehicleNo}
            onChange={(e) => setVehicleNo(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div>
          <Label>Transporter</Label>
          <Input
            value={transporter}
            onChange={(e) => setTransporter(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div>
          <Label>PO #</Label>
          <Input value={poNo} onChange={(e) => setPoNo(e.target.value)} />
        </div>
        <div>
          <Label>Bilty #</Label>
          <Input value={biltyNo} onChange={(e) => setBiltyNo(e.target.value)} />
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <Label>Remarks</Label>
          <Input
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Optional note for matching"
          />
        </div>
      </div>

      <ProductQtyLinesEditor
        products={catalog}
        lines={lines}
        onChange={setLines}
      />

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={loading}>
        {loading ? "Saving..." : "Save & print gate pass"}
      </Button>
    </form>
  );
}

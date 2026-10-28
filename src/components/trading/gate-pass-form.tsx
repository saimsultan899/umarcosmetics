"use client";

import { PartyCodePicker } from "@/components/forms/party-code-picker";
import {
  ProductQtyLinesEditor,
  type ProductQtyLine,
  type ProductQtyLinesEditorHandle,
} from "@/components/trading/product-qty-lines-editor";
import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { useDialogInvoiceNo } from "@/lib/trading/preview-document-no";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import { useSingleSubmit } from "@/lib/forms/single-submit";
import { offlineAwareSubmit } from "@/lib/offline/offline-submit";
import type { Party, Product, Warehouse } from "@/lib/types/database";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useRef, useState } from "react";

export type GatePassEdit = {
  id: string;
  passNo: string;
  partyId: string;
  warehouseId: string;
  passDate: string;
  manufacturer: string;
  vehicleNo: string;
  transporter: string;
  poNo: string;
  biltyNo: string;
  remarks: string;
  lines: ProductQtyLine[];
};

export function GatePassForm({
  companyId,
  organizationId,
  companyName,
  companyCity,
  companyNtn,
  parties,
  products,
  warehouses,
  editing,
  onDone,
}: {
  companyId: string;
  organizationId: string;
  companyName: string;
  companyCity?: string | null;
  companyNtn?: string | null;
  parties: Party[];
  products: Product[];
  warehouses: Warehouse[];
  editing?: GatePassEdit;
  onDone?: () => void;
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  useDialogInvoiceNo(companyId, "gate_pass", editing?.passNo);
  const linesEditorRef = useRef<ProductQtyLinesEditorHandle>(null);
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

  const [passDate, setPassDate] = useState(
    editing?.passDate || new Date().toISOString().slice(0, 10),
  );
  const [partyId, setPartyId] = useState(editing?.partyId || "");
  const [warehouseId, setWarehouseId] = useState(
    // New passes start blank — do not auto-pick the first company (e.g. Amelia).
    editing?.warehouseId || "",
  );
  const [manufacturer, setManufacturer] = useState(editing?.manufacturer || "");
  const [vehicleNo, setVehicleNo] = useState(editing?.vehicleNo || "");
  const [transporter, setTransporter] = useState(editing?.transporter || "");
  const [poNo, setPoNo] = useState(editing?.poNo || "");
  const [biltyNo, setBiltyNo] = useState(editing?.biltyNo || "");
  const [remarks, setRemarks] = useState(editing?.remarks || "");
  const [lines, setLines] = useState<ProductQtyLine[]>(editing?.lines || []);
  const [loading, setLoading] = useState(false);
  const singleSubmit = useSingleSubmit();
  const [error, setError] = useState<string | null>(null);

  /**
   * Brand filter for the product picker. Soft: always include an exact code match
   * from the full catalog so codes like 1749 still resolve when Brand is Soft Touch
   * but the product sits under another manufacturer (or when editing an old pass).
   */
  const catalog = useMemo(() => {
    if (!manufacturer) return products;
    const brand = manufacturer.trim().toLowerCase();
    return products.filter(
      (p) => (p.manufacturer || "").trim().toLowerCase() === brand,
    );
  }, [products, manufacturer]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await singleSubmit(async () => {
    setError(null);
    const flushed = linesEditorRef.current?.flush() || lines;
    const valid = flushed.filter((l) => l.product_id && Number(l.qty) > 0);
    if (valid.length === 0) {
      setError(
        "Add at least one product line (press Enter on qty, or click Save after selecting product + qty).",
      );
      return;
    }
    if (!warehouseId) {
      setError("Select the receive warehouse / company.");
      return;
    }

    setLoading(true);
    try {
      const res = await offlineAwareSubmit({
        mutationType: editing ? "gate_pass_update" : "gate_pass",
        companyId,
        organizationId,
        payload: {
          ...(editing
            ? {
                id: editing.id,
                gate_pass_id: editing.id,
                pass_no: editing.passNo,
              }
            : {}),
          organization_id: organizationId,
          company_id: companyId,
          pass_date: passDate,
          party_id: partyId || null,
          parties: (() => {
            const vendor = suppliers.find((p) => p.id === partyId);
            return vendor
              ? {
                  name_en: vendor.name_en,
                  party_code: vendor.party_code,
                  address: vendor.address,
                  city: vendor.city,
                  phone: vendor.phone,
                  mobile: vendor.mobile,
                  contact_person: vendor.contact_person,
                }
              : null;
          })(),
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
      closeDialog?.();
      onDone?.();
      if (editing || res.source === "offline") {
        router.refresh();
      } else {
        router.push(`/purchases/gate-passes/${res.id}`);
        router.refresh();
      }
    } catch (err: unknown) {
      setLoading(false);
      setError(err instanceof Error ? err.message : String(err));
    }
    });
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
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Narrows the product list. Use All products if a code is missing.
          </p>
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
        ref={linesEditorRef}
        products={catalog}
        codeLookupProducts={products}
        onResolvedOutsideList={(product) => {
          const brand = (product.manufacturer || "").trim();
          if (
            brand &&
            brand.toLowerCase() !== manufacturer.trim().toLowerCase()
          ) {
            setManufacturer(brand);
          } else if (!brand && manufacturer) {
            setManufacturer("");
          }
        }}
        lines={lines}
        onChange={setLines}
      />

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <Button type="submit" loading={loading}>
        {loading
          ? editing
            ? "Updating..."
            : "Saving..."
          : editing
            ? "Update gate pass"
            : "Save & print gate pass"}
      </Button>
    </form>
  );
}

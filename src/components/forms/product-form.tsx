"use client";

import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import {
  normalizePurchaseDiscountInput,
  purchaseDiscountPercentText,
} from "@/lib/pricing/discounts";
import { createClient } from "@/lib/supabase/client";
import type { Product, Warehouse } from "@/lib/types/database";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

export function ProductForm({
  companyId,
  organizationId,
  warehouses,
  initial,
  onDone,
}: {
  companyId: string;
  organizationId: string;
  warehouses: Warehouse[];
  initial?: Product | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoCode, setAutoCode] = useState(!initial);
  const [form, setForm] = useState({
    code: initial?.code || "",
    name_en: initial?.name_en || "",
    name_ur: initial?.name_ur || "",
    product_type: initial?.product_type || "",
    manufacturer: initial?.manufacturer || "",
    category_group: initial?.category_group || "",
    barcode: initial?.barcode || "",
    default_warehouse_id: initial?.default_warehouse_id || "",
    retail_rate: String(initial?.retail_rate ?? 0),
    purchase_rate: String(initial?.purchase_rate ?? 0),
    opening_qty: String(initial?.opening_qty ?? 0),
    packing: String(initial?.packing ?? 1),
    /** Supplier/company trade discount in percent (stored as products.scheme, e.g. 5%). */
    purchase_discount: initial?.scheme
      ? purchaseDiscountPercentText(initial.scheme)
      : "",
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc("peek_next_product_code", {
        p_company_id: companyId,
      });
      if (!cancelled && data) {
        setForm((f) => ({ ...f, code: String(data) }));
        setAutoCode(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, initial]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();

    let code = form.code.trim();
    if (!initial && autoCode) {
      const { data: allocated, error: allocError } = await supabase.rpc(
        "next_product_code",
        { p_company_id: companyId },
      );
      if (allocError) {
        setLoading(false);
        setError(allocError.message);
        return;
      }
      code = String(allocated);
      setForm((f) => ({ ...f, code }));
    }

    const openingQty = Number(form.opening_qty || 0);
    if (openingQty !== 0 && !form.default_warehouse_id) {
      setLoading(false);
      setError("Select a warehouse when opening quantity is not zero.");
      return;
    }

    const tradePrice = Number(form.retail_rate || 0);

    const normalizedDiscount = normalizePurchaseDiscountInput(form.purchase_discount);
    if (form.purchase_discount.trim() && !normalizedDiscount) {
      setLoading(false);
      setError("Purchase discount must be between 0 and 100%.");
      return;
    }

    // Persist via RPC so opening_qty also seeds/adjusts stock_balances
    // Hidden fields keep existing values on edit; new products get safe defaults.
    // sale_rate mirrors trade price so invoices still auto-fill correctly.
    const payload = {
      organization_id: organizationId,
      company_id: companyId,
      code,
      name_en: form.name_en.trim(),
      name_ur: form.name_ur.trim() || null,
      product_type: form.product_type.trim() || null,
      manufacturer: form.manufacturer.trim() || null,
      category_group: form.category_group.trim() || null,
      barcode: form.barcode.trim() || null,
      default_warehouse_id: form.default_warehouse_id || null,
      retail_rate: tradePrice,
      purchase_rate: Number(form.purchase_rate || 0),
      wholesale_rate: Number(initial?.wholesale_rate ?? 0),
      sale_rate: tradePrice,
      opening_qty: openingQty,
      opening_rate: Number(initial?.opening_rate ?? 0),
      reorder_level: Number(initial?.reorder_level ?? 0),
      packing: Number(form.packing || 1),
      scheme: normalizedDiscount,
    };

    const { error: saveError } = initial
      ? await supabase.rpc("update_product", {
          p_id: initial.id,
          p_payload: payload,
        })
      : await supabase.rpc("create_product", { p_payload: payload });

    setLoading(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    onDone?.();
    closeDialog?.();
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >
      <div>
        <Label>Code (auto serial)</Label>
        <Input
          value={form.code}
          onChange={(e) => {
            setAutoCode(false);
            set("code", e.target.value);
          }}
          required
          readOnly={!!initial}
          className={initial ? "bg-[var(--surface-2)]" : undefined}
        />
        {!initial ? (
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            {autoCode
              ? "Next serial reserved on save. Edit to override."
              : "Manual code — auto serial off for this entry."}
          </p>
        ) : null}
      </div>
      <div className="sm:col-span-2">
        <Label>Name (English)</Label>
        <Input value={form.name_en} onChange={(e) => set("name_en", e.target.value)} required />
      </div>
      <div>
        <Label>Urdu name</Label>
        <Input value={form.name_ur} onChange={(e) => set("name_ur", e.target.value)} dir="rtl" />
      </div>
      <div>
        <Label>Type</Label>
        <Input value={form.product_type} onChange={(e) => set("product_type", e.target.value)} placeholder="HAIR COLOUR" />
      </div>
      <div>
        <Label>Manufacturer</Label>
        <Input value={form.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} placeholder="KEUNE" />
      </div>
      <div>
        <Label>Group / Category</Label>
        <Input value={form.category_group} onChange={(e) => set("category_group", e.target.value)} />
      </div>
      <div>
        <Label>Warehouse</Label>
        <Select
          value={form.default_warehouse_id}
          onChange={(e) => set("default_warehouse_id", e.target.value)}
        >
          <option value="">Select warehouse</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label>Barcode</Label>
        <Input value={form.barcode} onChange={(e) => set("barcode", e.target.value)} />
      </div>
      <div>
        <Label>Trade price</Label>
        <Input type="number" step="0.01" value={form.retail_rate} onChange={(e) => set("retail_rate", e.target.value)} />
      </div>
      <div>
        <Label>Purchase rate</Label>
        <Input type="number" step="0.01" value={form.purchase_rate} onChange={(e) => set("purchase_rate", e.target.value)} />
      </div>
      <div>
        <Label>Opening qty</Label>
        <Input type="number" step="0.1" value={form.opening_qty} onChange={(e) => set("opening_qty", e.target.value)} />
      </div>
      <div>
        <Label>Packing</Label>
        <Input type="number" step="0.1" value={form.packing} onChange={(e) => set("packing", e.target.value)} />
      </div>
      <div>
        <Label>Purchase discount %</Label>
        <Input
          type="number"
          min="0"
          max="100"
          step="0.1"
          value={form.purchase_discount}
          onChange={(e) => set("purchase_discount", e.target.value)}
          placeholder="5"
        />
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          Supplier/company trade discount in percent — auto-fills on purchase invoices.
        </p>
      </div>

      {error ? (
        <p className="sm:col-span-2 lg:col-span-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="sm:col-span-2 lg:col-span-3">
        <Button type="submit" disabled={loading}>
          {loading ? "Saving..." : initial ? "Update product" : "Save product"}
        </Button>
      </div>
    </form>
  );
}

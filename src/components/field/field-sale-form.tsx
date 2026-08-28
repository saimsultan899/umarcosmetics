"use client";

import { useSyncStatus } from "@/components/offline/sync-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { enqueueMutation } from "@/lib/offline/db";
import { resolveProductRate } from "@/lib/product-rate";
import { computeLineScheme } from "@/lib/pricing/discounts";
import { createClient } from "@/lib/supabase/client";
import type { Product, Warehouse } from "@/lib/types/database";
import { formatPkr } from "@/lib/utils";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Shop = {
  party_id: string;
  party_code: string;
  name_en: string;
  route: string | null;
  city: string | null;
};

export function FieldSaleForm({
  companyId,
  organizationId,
  shops,
  products,
  warehouses,
}: {
  companyId: string;
  organizationId: string;
  shops: Shop[];
  products: Product[];
  warehouses: Warehouse[];
}) {
  const { online, refreshPending, runSync } = useSyncStatus();
  const [partyId, setPartyId] = useState(shops[0]?.party_id || "");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id || "");
  const [productId, setProductId] = useState("");
  const [productCode, setProductCode] = useState("");
  const [qty, setQty] = useState("1");
  const [scheme, setScheme] = useState("");
  const [bonus, setBonus] = useState("0");
  const [rate, setRate] = useState("0");
  const [rateHint, setRateHint] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const product = useMemo(
    () => products.find((p) => p.id === productId),
    [products, productId],
  );
  const shop = shops.find((s) => s.party_id === partyId);
  const amount = Math.max(0, Number(qty || 0) * Number(rate || 0));

  function applyScheme(nextScheme: string, nextQty: string, nextRate: string) {
    setScheme(nextScheme);
    const result = computeLineScheme(nextScheme, nextQty, nextRate);
    setBonus(String(result.freeQty || 0));
  }

  async function applyProduct(p: Product | null) {
    if (!p) {
      setProductId("");
      setProductCode("");
      setRate("0");
      setScheme("");
      setBonus("0");
      setRateHint("");
      return;
    }
    setProductId(p.id);
    setProductCode(p.code);
    let next = resolveProductRate(p, "sale_rate");
    let hint = next > 0 ? "Auto · Catalog rate" : "No catalog rate";

    if (partyId) {
      try {
        const supabase = createClient();
        const { data: lastRate } = await supabase.rpc("get_party_last_rate", {
          p_company_id: companyId,
          p_party_id: partyId,
          p_product_id: p.id,
        });
        if (lastRate != null && Number(lastRate) > 0) {
          next = Number(lastRate);
          hint = "Auto · Last rate for this shop";
        }
      } catch {
        // keep catalog
      }
    }

    setRate(String(next));
    setRateHint(hint);
    const nextQty = !qty || Number(qty) <= 0 ? "1" : qty;
    if (!qty || Number(qty) <= 0) setQty("1");
    applyScheme(scheme, nextQty, String(next));
  }

  async function resolveCode(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      await applyProduct(null);
      return;
    }
    const local = products.find(
      (p) => p.code.toLowerCase() === trimmed.toLowerCase(),
    );
    if (local) {
      await applyProduct(local);
      return;
    }
    setRateHint("No product for this code");
  }

  useEffect(() => {
    if (!product) return;
    void applyProduct(product);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!partyId || !warehouseId || !product || Number(qty) <= 0) {
      setError("Select shop, warehouse, product and qty.");
      return;
    }
    const lineRate = Number(rate || 0);
    if (lineRate <= 0) {
      setError("Rate is missing — pick a product with a catalog rate.");
      return;
    }
    const lineAmount = Math.max(0, Number(qty) * lineRate);

    const payload = {
      organization_id: organizationId,
      company_id: companyId,
      invoice_date: new Date().toISOString().slice(0, 10),
      party_id: partyId,
      warehouse_id: warehouseId,
      route: shop?.route || null,
      city: shop?.city || null,
      payment_type: "credit",
      amount_paid: 0,
      subtotal: lineAmount,
      discount_total: 0,
      grand_total: lineAmount,
      narration: "Field sale",
      items: [
        {
          product_id: product.id,
          product_code: product.code,
          product_name: product.name_en,
          qty: Number(qty),
          bonus_qty: Number(bonus || 0),
          rate: lineRate,
          discount: 0,
          scheme: scheme.trim() || null,
          amount: lineAmount,
        },
      ],
    };

    setLoading(true);
    try {
      if (!online) {
        await enqueueMutation({ companyId, type: "sale_invoice", payload });
        await refreshPending();
        setMessage("Sale saved offline. Sync later to post stock & ledger.");
      } else {
        const supabase = createClient();
        const { error: rpcError } = await supabase.rpc("create_sale_invoice", {
          p_payload: payload,
        });
        if (rpcError) throw new Error(rpcError.message);
        setMessage("Sale posted to main dashboard.");
        await runSync();
      }
      setQty("1");
    } catch (err) {
      if (online) {
        await enqueueMutation({ companyId, type: "sale_invoice", payload });
        await refreshPending();
        setMessage("Network issue — sale queued offline.");
      } else {
        setError(err instanceof Error ? err.message : "Failed");
      }
    } finally {
      setLoading(false);
    }
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
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label>Shop code</Label>
        <div className="grid grid-cols-[6rem_1fr] gap-2">
          <Input
            defaultValue={shop?.party_code || ""}
            key={partyId}
            placeholder="Code"
            onBlur={(e) => {
              const hit = shops.find(
                (s) =>
                  s.party_code.toLowerCase() ===
                  e.target.value.trim().toLowerCase(),
              );
              if (hit) setPartyId(hit.party_id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const value = (e.target as HTMLInputElement).value.trim();
                const hit = shops.find(
                  (s) => s.party_code.toLowerCase() === value.toLowerCase(),
                );
                if (hit) setPartyId(hit.party_id);
              }
            }}
          />
          <Select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
            {shops.map((s) => (
              <option key={s.party_id} value={s.party_id}>
                {s.party_code} — {s.name_en}
              </option>
            ))}
          </Select>
        </div>
        {shop ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            {[shop.city, shop.route].filter(Boolean).join(" · ") || shop.name_en}
          </p>
        ) : null}
      </div>
      <div>
        <Label>Warehouse</Label>
        <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>Product</Label>
        <div className="grid grid-cols-[6rem_1fr] gap-2">
          <Input
            value={productCode}
            placeholder="Code"
            onChange={(e) => setProductCode(e.target.value)}
            onBlur={() => void resolveCode(productCode)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void resolveCode(productCode);
              }
            }}
          />
          <Select
            value={productId}
            options={productOptions}
            onChange={(e) => {
              const p = products.find((x) => x.id === e.target.value) || null;
              void applyProduct(p);
            }}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <Label>Qty</Label>
          <Input
            type="number"
            min="0"
            step="0.1"
            value={qty}
            onChange={(e) => {
              const nextQty = e.target.value;
              setQty(nextQty);
              applyScheme(scheme, nextQty, rate);
            }}
            inputMode="decimal"
          />
        </div>
        <div>
          <Label>Scheme</Label>
          <Input
            value={scheme}
            placeholder="10+1"
            onChange={(e) => applyScheme(e.target.value, qty, rate)}
          />
        </div>
        <div>
          <Label>Bonus</Label>
          <Input
            type="number"
            min="0"
            step="0.1"
            value={bonus}
            readOnly
            className="bg-[var(--surface-2)]"
            inputMode="decimal"
            title="Auto from scheme"
          />
        </div>
        <div>
          <Label>Rate</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={rate}
            onChange={(e) => {
              setRate(e.target.value);
              setRateHint("Manual");
            }}
            inputMode="decimal"
          />
          {rateHint ? (
            <p className="mt-1 text-[10px] text-[var(--brand)]">{rateHint}</p>
          ) : null}
        </div>
        <div>
          <Label>Amount</Label>
          <Input value={formatPkr(amount)} readOnly />
        </div>
      </div>
      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}
      {message ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}
      <Button
        type="submit"
        className="w-full"
        disabled={loading || !shops.length || !products.length}
      >
        {loading ? "Saving..." : online ? "Post sale" : "Save offline"}
      </Button>
    </form>
  );
}

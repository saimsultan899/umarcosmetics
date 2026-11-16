"use client";

import { PartyCodePicker } from "@/components/forms/party-code-picker";
import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { useDialogInvoiceNo } from "@/lib/trading/preview-document-no";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectHandle } from "@/components/ui/select";
import { findProductByCodeOrBarcode } from "@/lib/barcode/match-product";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import { useSingleSubmit } from "@/lib/forms/single-submit";
import { offlineAwareSubmit } from "@/lib/offline/offline-submit";
import { productPieceRateMeta } from "@/lib/product-rate";
import type { Party, Product, Warehouse } from "@/lib/types/database";
import type { ExpiryStockRow } from "@/lib/queries/expiry";
import { AMOUNT_PLACEHOLDER, AMOUNT_STEP, formatNumber, formatPkr } from "@/lib/utils";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

type ClaimLine = {
  product_id: string;
  product_code: string;
  product_name: string;
  on_hand: number;
  rate: number;
  discountPct: string;
  send_qty: string;
  send_amount: number;
};

function money(value: number) {
  return Math.round(Math.max(0, value) * 100) / 100;
}

function claimAmount(qty: number, rate: number, discountPct: number) {
  const gross = qty * rate;
  const cut = Math.min(gross, (gross * Math.min(Math.max(discountPct, 0), 100)) / 100);
  return money(Math.max(0, gross - cut));
}

export function ExpiryClaimForm({
  companyId,
  organizationId,
  parties,
  warehouses,
  products = [],
  stock,
  onDone,
}: {
  companyId: string;
  organizationId: string;
  parties: Party[];
  warehouses: Warehouse[];
  products?: Product[];
  stock: ExpiryStockRow[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  useDialogInvoiceNo(companyId, "expiry_claim");
  const vendors = useMemo(
    () =>
      parties.filter(
        (p) =>
          p.party_subtype === "supplier" ||
          p.party_subtype === "both" ||
          p.party_type === "PARTY",
      ),
    [parties],
  );

  const [claimTo, setClaimTo] = useState<"company" | "vendor">("company");
  const [partyId, setPartyId] = useState("");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id || "");
  const [claimDate, setClaimDate] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [gstMode, setGstMode] = useState<"percent" | "amount">("amount");
  const [gstInput, setGstInput] = useState("");
  const [lines, setLines] = useState<ClaimLine[]>(() =>
    stock.map((row) => ({
      product_id: row.product_id,
      product_code: row.product_code,
      product_name: row.product_name,
      on_hand: row.qty,
      rate: row.rate,
      discountPct: "",
      send_qty: "",
      send_amount: 0,
    })),
  );
  const [draftCode, setDraftCode] = useState("");
  const [draftProductId, setDraftProductId] = useState("");
  const [draftQty, setDraftQty] = useState("1");
  const [draftDiscount, setDraftDiscount] = useState("");
  const [draftRate, setDraftRate] = useState<number>(0);
  const [draftRateText, setDraftRateText] = useState("");
  const [draftOnHand, setDraftOnHand] = useState<number>(0);
  const [hint, setHint] = useState<string | null>(null);

  const codeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const discountRef = useRef<HTMLInputElement>(null);
  const rateRef = useRef<HTMLInputElement>(null);
  const productSelectRef = useRef<SelectHandle>(null);

  const linkedVendor = useMemo(() => {
    if (!warehouseId) return null;
    const w = warehouses.find((item) => item.id === warehouseId);
    if (!w) return null;
    if (w.default_supplier_id) {
      return parties.find((p) => p.id === w.default_supplier_id) || null;
    }
    const byName = parties.find(
      (p) =>
        (p.party_subtype === "supplier" || p.party_subtype === "both") &&
        p.name_en.trim().toLowerCase() === w.name.trim().toLowerCase(),
    );
    return byName || null;
  }, [warehouseId, warehouses, parties]);

  useEffect(() => {
    if (stock.length > 0 && lines.length === 0) {
      setLines(
        stock.map((row) => ({
          product_id: row.product_id,
          product_code: row.product_code,
          product_name: row.product_name,
          on_hand: row.qty,
          rate: row.rate,
          discountPct: "",
          send_qty: "",
          send_amount: 0,
        })),
      );
    }
  }, [stock]);

  const selectableProducts = useMemo(() => {
    let pool = products;
    if (warehouseId) {
      const selectedWh = warehouses.find((w) => w.id === warehouseId);
      const byWh = products.filter(
        (p) =>
          p.default_warehouse_id === warehouseId ||
          (selectedWh &&
            p.manufacturer &&
            p.manufacturer.trim().toLowerCase() ===
              selectedWh.name.trim().toLowerCase()),
      );
      if (byWh.length > 0) pool = byWh;
    }
    if (pool.length > 0) return pool;
    return stock.map((s) => ({
      id: s.product_id,
      code: s.product_code,
      name_en: s.product_name,
      purchase_rate: s.rate,
      sale_rate: s.rate,
    })) as Product[];
  }, [products, stock, warehouseId, warehouses]);

  function patchLine(
    productId: string,
    patch: Partial<Pick<ClaimLine, "send_qty" | "rate" | "discountPct">>,
  ) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.product_id !== productId) return l;
        const next = { ...l, ...patch };
        const amount = claimAmount(
          Number(next.send_qty) || 0,
          Number(next.rate) || 0,
          Number(next.discountPct) || 0,
        );
        return { ...next, send_amount: amount };
      }),
    );
  }

  function applyProduct(p: Product | null) {
    if (!p) {
      setDraftProductId("");
      setDraftCode("");
      setDraftRate(0);
      setDraftRateText("");
      setDraftDiscount("");
      setDraftOnHand(0);
      setHint(null);
      return;
    }
    const inStock = stock.find((s) => s.product_id === p.id);
    const existing = lines.find((l) => l.product_id === p.id);
    const onHand = inStock ? inStock.qty : existing ? existing.on_hand : 0;
    const rate = inStock
      ? inStock.rate
      : existing
        ? existing.rate
        : Number(p.purchase_rate || p.sale_rate || 0);

    setDraftProductId(p.id);
    setDraftCode(p.code);
    setDraftRate(rate);
    setDraftRateText(rate > 0 ? String(money(rate)) : "");
    setDraftOnHand(onHand);
    setHint(null);
    requestAnimationFrame(() => {
      qtyRef.current?.focus();
      qtyRef.current?.select();
    });
  }

  const draftRecover = claimAmount(
    Number(draftQty) || 0,
    Number(draftRateText || draftRate) || 0,
    Number(draftDiscount) || 0,
  );

  function commitDraft() {
    const product =
      selectableProducts.find((p) => p.id === draftProductId) ||
      (draftCode.trim()
        ? findProductByCodeOrBarcode(selectableProducts, draftCode.trim())
        : null);
    if (!product) {
      setHint("Select a product to claim");
      codeRef.current?.focus();
      return;
    }
    const qty = draftQty.trim() ? draftQty.trim() : "1";
    const numQty = Number(qty);
    if (!(numQty > 0)) {
      setHint("Enter send qty");
      qtyRef.current?.focus();
      return;
    }
    const inStock = stock.find((s) => s.product_id === product.id);
    const existing = lines.find((l) => l.product_id === product.id);
    const onHand = inStock ? inStock.qty : existing ? existing.on_hand : 0;
    const rate =
      Number(draftRateText) > 0
        ? Number(draftRateText)
        : draftRate > 0
          ? draftRate
          : inStock
            ? inStock.rate
            : Number(product.purchase_rate || product.sale_rate || 0);
    const send_amount = claimAmount(numQty, rate, Number(draftDiscount) || 0);

    setLines((prev) => {
      const idx = prev.findIndex((l) => l.product_id === product.id);
      const row: ClaimLine = {
        product_id: product.id,
        product_code: product.code,
        product_name: product.name_en,
        on_hand: onHand,
        rate,
        discountPct: draftDiscount,
        send_qty: qty,
        send_amount,
      };
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = row;
        return next;
      }
      return [row, ...prev];
    });

    setDraftCode("");
    setDraftProductId("");
    setDraftQty("1");
    setDraftDiscount("");
    setDraftRate(0);
    setDraftRateText("");
    setDraftOnHand(0);
    setHint(null);
    requestAnimationFrame(() => {
      codeRef.current?.focus();
    });
  }

  function onDraftCodeKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    const trimmed = draftCode.trim();
    if (!trimmed) return;
    const found = findProductByCodeOrBarcode(selectableProducts, trimmed);
    if (found) {
      applyProduct(found);
    } else {
      setHint("No product for this code or barcode");
      productSelectRef.current?.open(trimmed);
    }
  }

  function onDraftQtyKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    discountRef.current?.focus();
    discountRef.current?.select();
  }

  function onDraftDiscountKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    rateRef.current?.focus();
    rateRef.current?.select();
  }

  function onDraftRateKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    commitDraft();
  }

  function removeLine(productId: string) {
    setLines((prev) => prev.filter((l) => l.product_id !== productId));
  }

  const [loading, setLoading] = useState(false);
  const singleSubmit = useSingleSubmit();
  const [error, setError] = useState<string | null>(null);

  const sendLines = lines
    .map((row) => {
      const qty = Number(row.send_qty || 0);
      return {
        ...row,
        sendQty: qty,
        sendAmount: claimAmount(qty, row.rate, Number(row.discountPct) || 0),
      };
    })
    .filter((row) => row.sendQty > 0);

  const subtotal = sendLines.reduce((s, l) => s + l.sendAmount, 0);
  const gstAmount =
    gstMode === "percent"
      ? money(Math.min(subtotal, (subtotal * Math.min(Number(gstInput) || 0, 100)) / 100))
      : money(Math.min(subtotal, Number(gstInput) || 0));
  const grandTotal = money(Math.max(0, subtotal - gstAmount));
  const sendQty = sendLines.reduce((s, l) => s + l.sendQty, 0);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await singleSubmit(async () => {
    setError(null);
    if (claimTo === "company" && !warehouseId) {
      setError("Select a company.");
      return;
    }
    if (claimTo === "vendor" && !partyId) {
      setError("Select a vendor.");
      return;
    }
    const effectivePartyId =
      claimTo === "company"
        ? linkedVendor?.id ||
          warehouses.find((w) => w.id === warehouseId)?.default_supplier_id ||
          partyId ||
          vendors[0]?.id ||
          ""
        : partyId;

    if (!effectivePartyId) {
      setError(
        claimTo === "company"
          ? "No vendor is linked to this company. Link one on the company, or choose Claim to: Vendor."
          : "Select a vendor.",
      );
      return;
    }
    if (sendLines.length === 0) {
      setError("Enter qty to send from expiry stock.");
      return;
    }
    setLoading(true);
    try {
      const res = await offlineAwareSubmit({
        mutationType: "expiry_claim",
        companyId,
        organizationId,
        payload: {
          organization_id: organizationId,
          company_id: companyId,
          claim_date: claimDate,
          party_id: effectivePartyId,
          parties: (() => {
            const vendor = parties.find((p) => p.id === effectivePartyId);
            return vendor
              ? {
                  name_en: vendor.name_en,
                  party_code: vendor.party_code,
                  phone: vendor.phone,
                  mobile: vendor.mobile,
                  contact_person: vendor.contact_person,
                }
              : null;
          })(),
          warehouse_id: warehouseId || null,
          subtotal,
          gst_mode: gstMode,
          gst_input: Number(gstInput) || 0,
          gst_amount: gstAmount,
          grand_total: grandTotal,
          narration,
          items: sendLines.map((l) => ({
            product_id: l.product_id,
            product_code: l.product_code,
            product_name: l.product_name,
            qty: l.sendQty,
            rate: l.rate,
            discount_percent: Number(l.discountPct) || 0,
            amount: l.sendAmount,
          })),
        },
      });

      setLoading(false);
      closeDialog?.();
      onDone?.();
      if (res.source === "offline") {
        router.refresh();
      } else {
        router.push(`/inventory/expiry/claims/${res.id}`);
        router.refresh();
      }
    } catch (err: any) {
      setLoading(false);
      setError(err?.message || String(err));
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Date</Label>
          <Input
            type="date"
            value={claimDate}
            onChange={(e) => setClaimDate(e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Claim to</Label>
          <Select
            value={claimTo}
            onChange={(e) => {
              const val = e.target.value as "company" | "vendor";
              setClaimTo(val);
              if (val === "company" && !warehouseId && warehouses[0]?.id) {
                setWarehouseId(warehouses[0].id);
              }
            }}
          >
            <option value="company">Company</option>
            <option value="vendor">Vendor</option>
          </Select>
        </div>
        {claimTo === "company" ? (
          <div className="sm:col-span-2">
            <Label>Company</Label>
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
            {linkedVendor ? (
              <p className="mt-1 text-xs text-[var(--muted)]">
                Credit goes to {linkedVendor.party_code} — {linkedVendor.name_en}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="sm:col-span-2">
            <PartyCodePicker
              companyId={companyId}
              parties={vendors}
              value={partyId}
              required
              label="Vendor"
              emptyLabel="Select vendor"
              filterSubtype={["supplier", "both"]}
              onChange={(id) => setPartyId(id)}
            />
          </div>
        )}
        <div className="sm:col-span-2 lg:col-span-4">
          <Label>Narration</Label>
          <Input
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="Expired stock sent to manufacturer"
          />
        </div>
      </div>

      <div className="table-grid table-grid--y-scroll">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr>
              <th className="w-28 min-w-[6.5rem]">Code</th>
              <th className="min-w-[12rem]">Product</th>
              <th className="w-24">On hand</th>
              <th className="w-24">Qty</th>
              <th className="w-24">Disc %</th>
              <th className="w-28">Rate</th>
              <th className="w-32">Amount</th>
              <th className="w-12 text-center" />
            </tr>
          </thead>
          <tbody>
            <tr className="bg-[var(--brand-soft)]/25">
              <td>
                <Input
                  ref={codeRef}
                  value={draftCode}
                  placeholder="Code or scan"
                  autoComplete="off"
                  className="h-8 px-2 text-sm font-medium tabular-nums"
                  onChange={(e) => {
                    setDraftCode(e.target.value);
                    if (hint) setHint(null);
                  }}
                  onKeyDown={onDraftCodeKeyDown}
                />
              </td>
              <td>
                <Select
                  ref={productSelectRef}
                  size="sm"
                  value={draftProductId}
                  onChange={(e) => {
                    const p = selectableProducts.find(
                      (x) => x.id === e.target.value,
                    );
                    applyProduct(p || null);
                  }}
                  options={[
                    { value: "", label: "Select product" },
                    ...selectableProducts.map((p) => ({
                      value: p.id,
                      label: `${p.code} — ${p.name_en}`,
                      meta: productPieceRateMeta(p, "purchase_rate"),
                    })),
                  ]}
                />
                {hint ? (
                  <p className="mt-0.5 text-[10px] text-rose-600">{hint}</p>
                ) : null}
              </td>
              <td className="px-3 py-2 tabular-nums text-xs text-[var(--muted)]">
                {draftOnHand > 0 ? formatNumber(draftOnHand, 2) : "—"}
              </td>
              <td>
                <Input
                  ref={qtyRef}
                  type="number"
                  min="0"
                  step="1"
                  placeholder="1"
                  value={draftQty}
                  className="h-8 px-2 text-sm"
                  onChange={(e) => setDraftQty(e.target.value)}
                  onKeyDown={onDraftQtyKeyDown}
                />
              </td>
              <td>
                <Input
                  ref={discountRef}
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="0"
                  value={draftDiscount}
                  className="h-8 px-2 text-sm"
                  onChange={(e) => setDraftDiscount(e.target.value)}
                  onKeyDown={onDraftDiscountKeyDown}
                />
              </td>
              <td>
                <Input
                  ref={rateRef}
                  type="number"
                  min="0"
                  step={AMOUNT_STEP}
                  placeholder="Rate"
                  value={draftRateText}
                  className="h-8 px-2 text-sm"
                  onChange={(e) => setDraftRateText(e.target.value)}
                  onKeyDown={onDraftRateKeyDown}
                />
              </td>
              <td className="px-3 py-2 tabular-nums text-xs font-medium">
                {draftRecover > 0 ? formatPkr(draftRecover) : "Rs 0.00"}
              </td>
              <td className="text-center">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-8 px-2.5 text-xs"
                  onClick={commitDraft}
                  title="Add product (or press Enter on Rate)"
                >
                  Add
                </Button>
              </td>
            </tr>

            {lines.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="py-4 text-center text-sm text-[var(--muted)]"
                >
                  Added products appear here. Keep using the top row to add more.
                </td>
              </tr>
            ) : (
              lines.map((line) => (
                <tr key={line.product_id}>
                  <td className="px-3 py-2 font-medium tabular-nums text-[var(--muted)]">
                    {line.product_code}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {line.product_name}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatNumber(line.on_hand, 2)}
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      type="number"
                      min="0"
                      max={line.on_hand > 0 ? line.on_hand : undefined}
                      step="1"
                      value={line.send_qty}
                      onChange={(e) =>
                        patchLine(line.product_id, { send_qty: e.target.value })
                      }
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={line.discountPct}
                      onChange={(e) =>
                        patchLine(line.product_id, {
                          discountPct: e.target.value,
                        })
                      }
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      type="number"
                      min="0"
                      step={AMOUNT_STEP}
                      value={line.rate}
                      onChange={(e) =>
                        patchLine(line.product_id, {
                          rate: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatPkr(line.send_amount)}
                  </td>
                  <td className="px-2 py-1 text-center">
                    <button
                      type="button"
                      className="rounded-lg p-1 text-[var(--muted)] hover:bg-rose-50 hover:text-rose-600 transition-colors"
                      onClick={() => removeLine(line.product_id)}
                      title="Remove product"
                      aria-label="Remove product"
                      data-enter-skip
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4 text-sm">
        <div className="space-y-1">
          <p className="font-semibold">{formatNumber(sendLines.length, 0)} products</p>
          <p className="text-[var(--muted)]">Total qty {formatNumber(sendQty, 0)}</p>
          <p>Claim {formatPkr(subtotal)}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Label className="text-xs uppercase tracking-wide text-[var(--muted)]">GST</Label>
          <div className="inline-flex rounded-md border border-[var(--border)] p-0.5 text-[10px] font-semibold uppercase">
            <button
              type="button"
              className={`rounded px-1.5 py-0.5 ${gstMode === "percent" ? "bg-[var(--brand)] text-white" : "text-[var(--muted)]"}`}
              onClick={() => setGstMode("percent")}
            >
              %
            </button>
            <button
              type="button"
              className={`rounded px-1.5 py-0.5 ${gstMode === "amount" ? "bg-[var(--brand)] text-white" : "text-[var(--muted)]"}`}
              onClick={() => setGstMode("amount")}
            >
              Amount
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min="0"
              step={AMOUNT_STEP}
              value={gstInput}
              onChange={(e) => setGstInput(e.target.value)}
              placeholder={gstMode === "percent" ? "0" : AMOUNT_PLACEHOLDER}
              className="h-9 w-28 text-right tabular-nums"
            />
            <span className="min-w-[5rem] text-right text-[var(--muted)]">
              − {formatPkr(gstAmount)}
            </span>
          </div>
          <p className="font-semibold">Vendor debit {formatPkr(grandTotal)}</p>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <Button type="submit" loading={loading} disabled={sendLines.length === 0}>
        {loading ? "Posting..." : "Send to vendor"}
      </Button>
    </form>
  );
}

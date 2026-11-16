"use client";

import { PartyCodePicker } from "@/components/forms/party-code-picker";
import { FilterMultiSelect } from "@/components/reports/filter-multi-select";
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
  warehouse_id: string | null;
  company_label: string;
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

function resolveStockWarehouseId(
  row: ExpiryStockRow,
  products: Product[],
  warehouses: Warehouse[],
): string | null {
  if (row.warehouse_id) return row.warehouse_id;
  const p = products.find((x) => x.id === row.product_id);
  if (!p) return null;
  if (p.default_warehouse_id) return p.default_warehouse_id;
  const mfg = (p.manufacturer || "").trim().toLowerCase();
  if (!mfg) return null;
  return (
    warehouses.find((w) => w.name.trim().toLowerCase() === mfg)?.id || null
  );
}

function stockBelongsToCompanies(
  row: ExpiryStockRow,
  warehouseIds: Set<string>,
  products: Product[],
  warehouses: Warehouse[],
): boolean {
  if (warehouseIds.size === 0) return false;
  const wid = resolveStockWarehouseId(row, products, warehouses);
  return Boolean(wid && warehouseIds.has(wid));
}

function companyName(
  warehouseId: string | null,
  warehouses: Warehouse[],
): string {
  if (!warehouseId) return "—";
  return warehouses.find((w) => w.id === warehouseId)?.name || "—";
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
  const [warehouseIds, setWarehouseIds] = useState<string[]>(() =>
    warehouses[0]?.id ? [warehouses[0].id] : [],
  );
  const [claimDate, setClaimDate] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [gstMode, setGstMode] = useState<"percent" | "amount">("amount");
  const [gstInput, setGstInput] = useState("");
  const [lines, setLines] = useState<ClaimLine[]>([]);
  const [omittedIds, setOmittedIds] = useState<string[]>([]);
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

  const warehouseIdSet = useMemo(() => new Set(warehouseIds), [warehouseIds]);

  const companyOptions = useMemo(() => {
    const withStock = new Set(
      stock
        .map((row) => resolveStockWarehouseId(row, products, warehouses))
        .filter(Boolean) as string[],
    );
    const list = warehouses
      .filter((w) => withStock.has(w.id) || warehouseIdSet.has(w.id))
      .map((w) => ({ value: w.id, label: w.name }));
    if (list.length > 0) {
      return list.sort((a, b) => a.label.localeCompare(b.label));
    }
    return warehouses
      .map((w) => ({ value: w.id, label: w.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [warehouses, stock, products, warehouseIdSet]);

  const filteredStock = useMemo(
    () =>
      stock.filter((row) =>
        stockBelongsToCompanies(row, warehouseIdSet, products, warehouses),
      ),
    [stock, warehouseIdSet, products, warehouses],
  );

  const warehouseKey = warehouseIds.slice().sort().join(",");

  useEffect(() => {
    const omitted = new Set(omittedIds);
    setLines((prev) => {
      const prevMap = new Map(prev.map((l) => [l.product_id, l]));
      return filteredStock
        .filter((row) => !omitted.has(row.product_id))
        .map((row) => {
          const wid = resolveStockWarehouseId(row, products, warehouses);
          const existing = prevMap.get(row.product_id);
          if (existing) {
            return {
              ...existing,
              warehouse_id: wid,
              company_label: companyName(wid, warehouses),
              on_hand: row.qty,
              rate: existing.rate > 0 ? existing.rate : row.rate,
              send_amount: claimAmount(
                Number(existing.send_qty) || 0,
                existing.rate > 0 ? existing.rate : row.rate,
                Number(existing.discountPct) || 0,
              ),
            };
          }
          return {
            product_id: row.product_id,
            product_code: row.product_code,
            product_name: row.product_name,
            warehouse_id: wid,
            company_label: companyName(wid, warehouses),
            on_hand: row.qty,
            rate: row.rate,
            discountPct: "",
            send_qty: "",
            send_amount: 0,
          };
        });
    });
  }, [filteredStock, products, warehouses, omittedIds]);

  useEffect(() => {
    setOmittedIds([]);
    setDraftCode("");
    setDraftProductId("");
    setDraftQty("1");
    setDraftDiscount("");
    setDraftRate(0);
    setDraftRateText("");
    setDraftOnHand(0);
    setHint(null);
  }, [warehouseKey]);

  const selectableProducts = useMemo(() => {
    const allowed = new Set(filteredStock.map((s) => s.product_id));
    const fromCatalog = products.filter((p) => allowed.has(p.id));
    if (fromCatalog.length > 0) return fromCatalog;
    return filteredStock.map((s) => ({
      id: s.product_id,
      code: s.product_code,
      name_en: s.product_name,
      purchase_rate: s.rate,
      sale_rate: s.rate,
      default_warehouse_id: s.warehouse_id,
    })) as Product[];
  }, [products, filteredStock]);

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
    const inStock = filteredStock.find((s) => s.product_id === p.id);
    const existing = lines.find((l) => l.product_id === p.id);
    const onHand = inStock ? inStock.qty : existing ? existing.on_hand : 0;
    const rate = inStock
      ? inStock.rate
      : existing
        ? existing.rate
        : Number(p.purchase_rate || p.sale_rate || 0);

    if (!inStock) {
      setHint("This product is not in expiry stock for the selected companies");
      return;
    }

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
    const inStock = filteredStock.find((s) => s.product_id === product.id);
    if (!inStock) {
      setHint("This product is not in expiry stock for the selected companies");
      return;
    }
    const existing = lines.find((l) => l.product_id === product.id);
    const onHand = inStock.qty;
    const wid = resolveStockWarehouseId(inStock, products, warehouses);
    const rate =
      Number(draftRateText) > 0
        ? Number(draftRateText)
        : draftRate > 0
          ? draftRate
          : inStock.rate;
    const send_amount = claimAmount(numQty, rate, Number(draftDiscount) || 0);

    setLines((prev) => {
      const idx = prev.findIndex((l) => l.product_id === product.id);
      const row: ClaimLine = {
        product_id: product.id,
        product_code: product.code,
        product_name: product.name_en,
        warehouse_id: wid,
        company_label: companyName(wid, warehouses),
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
    setOmittedIds((prev) =>
      prev.includes(productId) ? prev : [...prev, productId],
    );
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
    if (warehouseIds.length === 0) {
      setError("Select at least one company.");
      return;
    }
    if (claimTo === "vendor" && !partyId) {
      setError("Select a vendor.");
      return;
    }
    // Company claims are brand/warehouse scoped only — vendor is separate and optional.
    const effectivePartyId = claimTo === "vendor" ? partyId : "";
    if (sendLines.length === 0) {
      setError("Enter qty to send from expiry stock.");
      return;
    }
    const selectedCompanyNames = warehouseIds
      .map((id) => companyName(id, warehouses))
      .filter((name) => name !== "—");
    const companyNote =
      selectedCompanyNames.length > 1
        ? `Companies: ${selectedCompanyNames.join(", ")}`
        : selectedCompanyNames[0]
          ? `Company: ${selectedCompanyNames[0]}`
          : "";
    const finalNarration = [narration.trim(), companyNote]
      .filter(Boolean)
      .join(" — ");

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
          party_id: effectivePartyId || null,
          parties: (() => {
            if (!effectivePartyId) return null;
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
          warehouse_id: warehouseIds[0] || null,
          warehouse_ids: warehouseIds,
          subtotal,
          gst_mode: gstMode,
          gst_input: Number(gstInput) || 0,
          gst_amount: gstAmount,
          grand_total: grandTotal,
          narration: finalNarration,
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
              setClaimTo(e.target.value as "company" | "vendor");
            }}
          >
            <option value="company">Company</option>
            <option value="vendor">Vendor</option>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <FilterMultiSelect
            name="claim_companies"
            label="Companies"
            value={warehouseIds.join(",")}
            options={companyOptions}
            allLabel="Select companies"
            placeholder="Select one or more companies"
            searchPlaceholder="Search companies..."
            onChange={(ids) => setWarehouseIds(ids)}
          />
          <p className="mt-1 text-xs text-[var(--muted)]">
            Only expiry stock for the selected companies is listed.
          </p>
        </div>
        {claimTo === "company" ? (
          <div className="sm:col-span-2 lg:col-span-4">
            <p className="text-xs text-[var(--muted)]">
              Claim to company sends selected brand stock only. No vendor ledger
              is cut. Use Claim to: Vendor when you also want a vendor debit.
            </p>
          </div>
        ) : (
          <div className="sm:col-span-2 lg:col-span-2">
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
        <table className="w-full min-w-[1080px] text-sm">
          <thead>
            <tr>
              <th className="w-28 min-w-[6.5rem]">Code</th>
              <th className="min-w-[12rem]">Product</th>
              <th className="w-32">Company</th>
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
                  disabled={warehouseIds.length === 0}
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
                    {
                      value: "",
                      label:
                        warehouseIds.length === 0
                          ? "Select companies first"
                          : "Select product",
                    },
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
              <td className="px-3 py-2 text-xs text-[var(--muted)]">—</td>
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

            {warehouseIds.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="py-4 text-center text-sm text-[var(--muted)]"
                >
                  Select one or more companies to load their expiry stock.
                </td>
              </tr>
            ) : lines.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="py-4 text-center text-sm text-[var(--muted)]"
                >
                  No expiry stock for the selected companies. Add a return first,
                  or pick other companies.
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
                  <td className="px-3 py-2 text-xs text-[var(--muted)]">
                    {line.company_label}
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
          <p className="font-semibold">
            {claimTo === "vendor"
              ? `Vendor debit ${formatPkr(grandTotal)}`
              : `Claim ${formatPkr(grandTotal)}`}
          </p>
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

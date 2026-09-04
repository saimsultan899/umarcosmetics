"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectHandle } from "@/components/ui/select";
import { focusField } from "@/lib/keyboard/enter-nav";
import {
  rateSourceLabel,
  resolveProductRate,
  type RateField,
} from "@/lib/product-rate";
import { createClient } from "@/lib/supabase/client";
import type { Product, Warehouse } from "@/lib/types/database";
import {
  calcLineAmount,
  calcLineDiscount,
  emptyLine,
  type LineItemDraft,
} from "@/lib/types/trading";
import { QtyUnitControl } from "@/components/trading/qty-unit-control";
import {
  formatUomCompact,
  hasCartonPacking,
  perCartonRate,
} from "@/lib/pricing/uom";
import { computeLineScheme, purchaseDiscountPercentText } from "@/lib/pricing/discounts";
import { formatPkr, cn } from "@/lib/utils";
import { Trash2 } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

type Draft = LineItemDraft;

function blankDraft(): Draft {
  return emptyLine();
}

export function LineItemsEditor({
  products,
  lines,
  onChange,
  rateField = "sale_rate",
  companyId,
  partyId,
  autoFocus = true,
  /** Distributor→shop item-wise free goods (e.g. 10+1 from product bonus). */
  enableBonus = false,
  /** Currently selected header warehouse (sale invoice). */
  warehouseId,
  warehouses,
  /** product_id → warehouses stocking it, highest qty first. Enables stock hints. */
  stockByProduct,
  /** Auto-selects stocked warehouse (sale) or product default warehouse (purchase). */
  onAutoPickWarehouse,
  /** Show company control above product lines (sale invoice). */
  showCompanyPicker = false,
  /** Optional invoice-level extra discount (sale invoice footer). */
  extraDiscount,
  onExtraDiscountChange,
}: {
  products: Product[];
  lines: LineItemDraft[];
  onChange: (lines: LineItemDraft[]) => void;
  rateField?: RateField;
  companyId?: string;
  partyId?: string;
  /** Focus the sticky code field when the editor mounts / resets. */
  autoFocus?: boolean;
  enableBonus?: boolean;
  warehouseId?: string;
  warehouses?: Warehouse[];
  stockByProduct?: Map<string, { warehouseId: string; qty: number }[]>;
  onAutoPickWarehouse?: (warehouseId: string) => void;
  showCompanyPicker?: boolean;
  extraDiscount?: string;
  onExtraDiscountChange?: (value: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [hint, setHint] = useState<string | null>(null);
  const [lineHints, setLineHints] = useState<Record<string, string>>({});
  const [productOpen, setProductOpen] = useState(false);
  /** Immediate company id while parent warehouseId catches up after auto-pick. */
  const [pickedWarehouseId, setPickedWarehouseId] = useState<string | null>(
    null,
  );

  const linesRef = useRef(lines);
  const draftRef = useRef(draft);
  const warehouseIdRef = useRef(warehouseId);
  const codeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const schemeRef = useRef<HTMLInputElement>(null);
  const rateRef = useRef<HTMLInputElement>(null);
  const discountRef = useRef<HTMLInputElement>(null);
  const productSelectRef = useRef<SelectHandle>(null);

  const effectiveWarehouseId = pickedWarehouseId || warehouseId;

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    warehouseIdRef.current = warehouseId;
    // Parent caught up — drop local override
    if (pickedWarehouseId && pickedWarehouseId === warehouseId) {
      setPickedWarehouseId(null);
    }
  }, [warehouseId, pickedWarehouseId]);

  useEffect(() => {
    if (!autoFocus) return;
    const t = requestAnimationFrame(() => focusField(codeRef.current));
    return () => cancelAnimationFrame(t);
  }, [autoFocus]);

  function pickWarehouse(nextId: string) {
    if (!nextId || nextId === warehouseIdRef.current) return;
    warehouseIdRef.current = nextId;
    setPickedWarehouseId(nextId);
    onAutoPickWarehouse?.(nextId);
  }

  function schemeFields(scheme: string, qty: string, rate: string) {
    if (!enableBonus) return { scheme };
    const result = computeLineScheme(scheme, qty, rate);
    return {
      scheme,
      bonus: String(result.freeQty || 0),
    };
  }

  function patchDraftWithScheme(scheme: string) {
    const current = draftRef.current;
    patchDraft(
      schemeFields(scheme, current.qty, current.rate),
    );
  }

  function patchLineWithScheme(
    key: string,
    scheme: string,
    qty: string,
    rate: string,
  ) {
    patchLine(key, schemeFields(scheme, qty, rate));
  }

  function patchDraft(patch: Partial<Draft>) {
    setDraft((prev) => {
      const merged = { ...prev, ...patch };
      merged.amount = calcLineAmount(merged.qty, merged.rate, merged.discount);
      draftRef.current = merged;
      return merged;
    });
  }

  function patchLine(key: string, patch: Partial<LineItemDraft>) {
    const next = linesRef.current.map((line) => {
      if (line.key !== key) return line;
      const merged = { ...line, ...patch };
      merged.amount = calcLineAmount(merged.qty, merged.rate, merged.discount);
      return merged;
    });
    linesRef.current = next;
    onChange(next);
  }

  async function resolveRate(product: Product) {
    let rate = resolveProductRate(product, rateField);
    let sourceHint = rateSourceLabel(product, rateField, rate);

    if (companyId && partyId && product.id) {
      try {
        const supabase = createClient();
        const { data: lastRate } = await supabase.rpc("get_party_last_rate", {
          p_company_id: companyId,
          p_party_id: partyId,
          p_product_id: product.id,
        });
        if (lastRate != null && Number(lastRate) > 0) {
          rate = Number(lastRate);
          sourceHint = "Auto · Last rate for this party";
        }
      } catch {
        // Keep catalog rate if RPC unavailable offline
      }
    }

    return { rate, hint: sourceHint };
  }

  const warehouseLabel = (id?: string) =>
    warehouses?.find((w) => w.id === id)?.name || "selected warehouse";

  function formatStockQty(qty: number, productId?: string) {
    const p = productId ? productById.get(productId) : undefined;
    if (p && hasCartonPacking(p.packing)) {
      return formatUomCompact(qty, p.packing, {
        unitType: p.unit_type,
        baseUnit: p.base_unit,
      });
    }
    return Number.isInteger(qty)
      ? String(qty)
      : qty.toFixed(2).replace(/\.?0+$/, "");
  }

  type StockNote = { tone: "ok" | "warn" | "bad"; text: string };

  function productCompanyId(productId?: string) {
    if (!productId) return undefined;
    return (
      products.find((p) => p.id === productId)?.default_warehouse_id || undefined
    );
  }

  /** Qty already committed on this invoice for a product (paid + free). */
  function reservedQty(productId: string, exceptKey?: string) {
    return linesRef.current
      .filter((l) => l.product_id === productId && l.key !== exceptKey)
      .reduce(
        (s, l) => s + Number(l.qty || 0) + Number(l.bonus || 0),
        0,
      );
  }

  /** Remaining stock in a company after reserved lines. */
  function availableInCompany(
    productId: string,
    companyId: string | undefined,
    exceptKey?: string,
  ) {
    if (!stockByProduct || !companyId || !productId) return null;
    const onHand =
      stockByProduct
        .get(productId)
        ?.find((e) => e.warehouseId === companyId)?.qty ?? 0;
    return Math.max(0, onHand - reservedQty(productId, exceptKey));
  }

  function availableInSelectedCompany(productId: string, exceptKey?: string) {
    const companyId = productCompanyId(productId) || effectiveWarehouseId;
    return availableInCompany(productId, companyId, exceptKey);
  }

  /**
   * Stock hint — always for the product's own company when assigned.
   */
  function stockNoteFor(productId: string): StockNote | null {
    if (!productId || !stockByProduct) return null;

    const productWh = productCompanyId(productId);
    const activeWh = productWh || effectiveWarehouseId;
    const entries = stockByProduct.get(productId);

    if (!entries || entries.length === 0) {
      return {
        tone: "bad",
        text: `Out of stock${activeWh ? ` in ${warehouseLabel(activeWh)}` : ""}`,
      };
    }

    const inOwn = activeWh
      ? entries.find((e) => e.warehouseId === activeWh)
      : undefined;
    const ownQty = inOwn?.qty ?? 0;
    const avail = availableInCompany(productId, activeWh);

    if (ownQty > 0) {
      const availText =
        avail != null && avail < ownQty
          ? ` · left ${formatStockQty(avail, productId)}`
          : "";
      return {
        tone: "ok",
        text: `In stock: ${warehouseLabel(activeWh)} · ${formatStockQty(ownQty, productId)}${availText}`,
      };
    }

    return {
      tone: "bad",
      text: `Out of stock in ${warehouseLabel(activeWh)}`,
    };
  }

  /** Alert when qty + scheme free exceeds remaining stock in the product's company. */
  function overstockAlert(
    productId: string,
    qty: string,
    bonus: string,
    exceptKey?: string,
  ): string | null {
    if (!productId || !stockByProduct) return null;
    const productWh = productCompanyId(productId);
    const companyId = productWh || effectiveWarehouseId;
    if (!companyId) return null;
    const avail = availableInCompany(productId, companyId, exceptKey);
    if (avail == null) return null;
    const need = Number(qty || 0) + Number(bonus || 0);
    if (!(need > avail)) return null;
    return `Only ${formatStockQty(avail, productId)} available in ${warehouseLabel(companyId)} (need ${formatStockQty(need, productId)})`;
  }

  async function applyProductToDraft(p: Product | null) {
    if (!p) {
      patchDraft({
        product_id: "",
        product_code: "",
        product_name: "",
        rate: "0",
      });
      setHint(null);
      return;
    }

    const catalog =
      products.find((x) => x.id === p.id) ||
      products.find(
        (x) => x.code.toLowerCase() === String(p.code || "").toLowerCase(),
      ) ||
      p;

    // Always switch Company to the product's assigned company (mixed bills OK).
    if (onAutoPickWarehouse && catalog.id && catalog.default_warehouse_id) {
      pickWarehouse(catalog.default_warehouse_id);
    } else if (
      onAutoPickWarehouse &&
      catalog.id &&
      !catalog.default_warehouse_id &&
      stockByProduct
    ) {
      const currentWh = warehouseIdRef.current;
      const entries = stockByProduct.get(catalog.id);
      const currentHasStock =
        !!currentWh &&
        !!entries?.some((e) => e.warehouseId === currentWh && e.qty > 0);
      if (entries?.length && !currentHasStock) {
        pickWarehouse(entries[0].warehouseId);
      }
    }

    const current = draftRef.current;
    const qty = current && Number(current.qty) > 0 ? current.qty : "1";
    const { rate, hint: rateHint } = await resolveRate(catalog);

    const purchaseDiscount =
      rateField === "purchase_rate"
        ? purchaseDiscountPercentText(catalog.scheme)
        : "0";
    const scheme = enableBonus ? "" : current?.scheme || "";
    const bonusFields = enableBonus
      ? schemeFields(scheme, qty, String(rate))
      : { bonus: current?.bonus || "0", scheme };

    patchDraft({
      product_id: catalog.id,
      product_code: catalog.code,
      product_name: catalog.name_en,
      qty,
      rate: String(rate),
      discount:
        rateField === "purchase_rate" ? purchaseDiscount : "0",
      ...bonusFields,
    });
    setHint(
      rateField === "purchase_rate" && Number(purchaseDiscount) > 0
        ? `${rateHint} · Purchase discount ${purchaseDiscount}%`
        : bonusFields.scheme && Number(bonusFields.bonus) > 0
          ? `${rateHint} · Scheme ${bonusFields.scheme}`
          : rateHint,
    );
  }

  async function resolveProductCode(raw: string): Promise<Product | null> {
    const trimmed = raw.trim();
    if (!trimmed) {
      await applyProductToDraft(null);
      setHint(null);
      return null;
    }

    const local =
      products.find((p) => p.code.toLowerCase() === trimmed.toLowerCase()) ||
      null;
    if (local) {
      await applyProductToDraft(local);
      return local;
    }

    if (!companyId) {
      setHint("No product for this code");
      return null;
    }

    const supabase = createClient();
    const { data } = await supabase.rpc("get_product_by_code", {
      p_company_id: companyId,
      p_code: trimmed,
    });
    const product = Array.isArray(data) ? data[0] : data;
    if (product) {
      await applyProductToDraft(product as Product);
      return product as Product;
    }
    setHint("No product for this code");
    return null;
  }

  function setCodeValue(value: string) {
    if (
      hint === "No product for this code" ||
      hint === "Select a product and enter qty"
    ) {
      setHint(null);
    }

    const trimmed = value.trim();
    const matched = trimmed
      ? products.find((p) => p.code.toLowerCase() === trimmed.toLowerCase())
      : null;

    if (matched) {
      void applyProductToDraft(matched);
      return;
    }

    const prev = draftRef.current;
    patchDraft({
      product_code: value,
      ...(prev.product_id
        ? { product_id: "", product_name: "", rate: "0" }
        : {}),
    });
  }

  function resetDraft() {
    const next = blankDraft();
    draftRef.current = next;
    setDraft(next);
    setHint(null);
    setProductOpen(false);
  }

  function commitDraft() {
    const current = draftRef.current;
    if (!current.product_id || Number(current.qty) <= 0) {
      setHint("Select a product and enter qty");
      focusField(codeRef.current);
      return false;
    }

    const stockErr = overstockAlert(
      current.product_id,
      current.qty,
      current.bonus || "0",
    );
    if (stockErr) {
      setHint(stockErr);
      focusField(qtyRef.current);
      return false;
    }

    const committed: LineItemDraft = {
      ...current,
      key: crypto.randomUUID(),
      amount: calcLineAmount(current.qty, current.rate, current.discount),
    };

    if (hint) {
      setLineHints((h) => ({ ...h, [committed.key]: hint }));
    }

    const next = [...linesRef.current, committed];
    linesRef.current = next;
    onChange(next);
    resetDraft();
    requestAnimationFrame(() => focusField(codeRef.current));
    return true;
  }

  async function onCodeEnter(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();

    const found = await resolveProductCode(draftRef.current.product_code);
    if (found) {
      focusField(qtyRef.current);
      return;
    }
    // Open product dropdown so user can search/select
    setProductOpen(true);
    productSelectRef.current?.open(draftRef.current.product_code);
  }

  async function onProductPicked(productId: string) {
    const p = products.find((x) => x.id === productId) || null;
    await applyProductToDraft(p);
    if (p) {
      requestAnimationFrame(() => focusField(qtyRef.current));
    }
  }

  function onQtyEnter(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    if (enableBonus) {
      focusField(schemeRef.current);
      return;
    }
    focusField(rateRef.current);
  }

  function onSchemeEnter(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    focusField(rateRef.current);
  }

  function onRateEnter(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    focusField(discountRef.current);
  }

  function onDiscountEnter(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    commitDraft();
  }

  // When party changes, refresh auto rates for already picked products
  const prevParty = useRef(partyId);
  useEffect(() => {
    if (prevParty.current === partyId) return;
    prevParty.current = partyId;
    let cancelled = false;
    async function refresh() {
      const current = linesRef.current;
      for (const line of current) {
        if (!line.product_id) continue;
        const product = products.find((p) => p.id === line.product_id) || null;
        if (!product) continue;
        const { rate, hint: rateHint } = await resolveRate(product);
        if (cancelled) return;
        patchLine(line.key, { rate: String(rate) });
        setLineHints((h) => ({ ...h, [line.key]: rateHint }));
      }
      const d = draftRef.current;
      if (d.product_id) {
        const product = products.find((p) => p.id === d.product_id) || null;
        if (product) {
          const { rate, hint: rateHint } = await resolveRate(product);
          if (cancelled) return;
          patchDraft({ rate: String(rate) });
          setHint(rateHint);
        }
      }
    }
    void refresh();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId]);

  const subtotal = lines.reduce(
    (s, l) => s + Number(l.qty || 0) * Number(l.rate || 0),
    0,
  );
  const discount = lines.reduce(
    (s, l) => s + calcLineDiscount(l.qty, l.rate, l.discount),
    0,
  );
  const grand = lines.reduce((s, l) => s + l.amount, 0);
  const extra = Math.max(0, Number(extraDiscount || 0));
  const billTotal = Math.max(0, grand - extra);
  const draftAmount = calcLineAmount(draft.qty, draft.rate, draft.discount);

  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

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

  function removeLine(key: string) {
    setLineHints((h) => {
      const next = { ...h };
      delete next[key];
      return next;
    });
    const next = lines.filter((l) => l.key !== key);
    linesRef.current = next;
    onChange(next);
    requestAnimationFrame(() => focusField(codeRef.current));
  }

  return (
    <div className="space-y-3" data-enter-own>
      {showCompanyPicker && warehouses && warehouses.length > 0 ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1 sm:max-w-xs">
            <Label>Company</Label>
            <Select
              value={effectiveWarehouseId || ""}
              onChange={(e) => {
                const next = e.target.value;
                warehouseIdRef.current = next;
                setPickedWarehouseId(null);
                onAutoPickWarehouse?.(next);
              }}
              options={[
                { value: "", label: "Auto from product" },
                ...warehouses.map((w) => ({
                  value: w.id,
                  label: w.name,
                })),
              ]}
            />
            <p className="mt-1 text-[11px] text-[var(--muted)]">
              Fills automatically when you pick a product.
            </p>
          </div>
        </div>
      ) : null}

      <div className="table-grid">
        <table className="w-full min-w-[1080px] text-sm">
          <thead>
            <tr>
              <th className="w-28 min-w-[7rem]">Code</th>
              <th>Product</th>
              <th className="w-36 min-w-[9rem]">Qty</th>
              {enableBonus ? <th className="w-28 min-w-[6.5rem]">Scheme</th> : null}
              <th className="w-28 min-w-[6.5rem]">Rate</th>
              <th className="w-28 min-w-[6.5rem]">Discount %</th>
              <th className="w-28 min-w-[6.5rem]">Amount</th>
              <th className="w-14 min-w-[3.5rem]" />
            </tr>
          </thead>
          <tbody>
            {/* Sticky quick-entry row */}
            <tr className="bg-[var(--brand-soft)]/25">
              <td className="w-28 min-w-[7rem]">
                <Input
                  ref={codeRef}
                  value={draft.product_code}
                  placeholder="Code"
                  autoComplete="off"
                  className="px-2 font-medium tabular-nums"
                  onChange={(e) => setCodeValue(e.target.value)}
                  onKeyDown={onCodeEnter}
                />
              </td>
              <td>
                <Select
                  ref={productSelectRef}
                  size="sm"
                  value={draft.product_id}
                  options={productOptions}
                  maxVisible={12}
                  open={productOpen}
                  onOpenChange={setProductOpen}
                  onChange={(e) => void onProductPicked(e.target.value)}
                />
                {(() => {
                  const note = stockNoteFor(draft.product_id);
                  const over = overstockAlert(
                    draft.product_id,
                    draft.qty,
                    draft.bonus || "0",
                  );
                  if (!note && !over) return null;
                  return (
                    <>
                      {note ? (
                        <p
                          className={cn(
                            "mt-1 text-[10px]",
                            note.tone === "ok"
                              ? "text-[var(--brand)]"
                              : note.tone === "warn"
                                ? "text-amber-700"
                                : "text-rose-600",
                          )}
                        >
                          {note.text}
                        </p>
                      ) : null}
                      {over ? (
                        <p className="mt-1 text-[10px] font-medium text-rose-600">
                          {over}
                        </p>
                      ) : null}
                    </>
                  );
                })()}
              </td>
              <td>
                <QtyUnitControl
                  packing={productById.get(draft.product_id)?.packing ?? 1}
                  unitType={productById.get(draft.product_id)?.unit_type}
                  baseUnit={productById.get(draft.product_id)?.base_unit}
                  qty={draft.qty}
                  qtyInputRef={qtyRef}
                  onQtyChange={(qty) => {
                    patchDraft({
                      qty,
                      ...schemeFields(
                        draftRef.current.scheme,
                        qty,
                        draftRef.current.rate,
                      ),
                    });
                  }}
                  onQtyKeyDown={onQtyEnter}
                  compact
                />
              </td>
              {enableBonus ? (
                <td>
                  <Input
                    ref={schemeRef}
                    value={draft.scheme}
                    placeholder="+1"
                    onChange={(e) => patchDraftWithScheme(e.target.value)}
                    onKeyDown={onSchemeEnter}
                    title="Item-wise shop scheme, e.g. +1 or 10+1"
                  />
                  {Number(draft.bonus) > 0 ? (
                    <p className="mt-1 text-[10px] text-[var(--muted)]">
                      +{draft.bonus} free
                    </p>
                  ) : null}
                </td>
              ) : null}
              <td>
                <Input
                  ref={rateRef}
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.rate}
                  onChange={(e) => {
                    const rate = e.target.value;
                    patchDraft({
                      rate,
                      ...schemeFields(
                        draftRef.current.scheme,
                        draftRef.current.qty,
                        rate,
                      ),
                    });
                  }}
                  onKeyDown={onRateEnter}
                />
                {hint ? (
                  <p className="mt-1 text-[10px] text-[var(--brand)]">{hint}</p>
                ) : null}
              </td>
              <td>
                <Input
                  ref={discountRef}
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={draft.discount}
                  onChange={(e) => patchDraft({ discount: e.target.value })}
                  onKeyDown={onDiscountEnter}
                  title="Line discount percent"
                />
                {Number(draft.discount) > 0 ? (
                  <p className="mt-1 text-[10px] text-[var(--muted)]">
                    {formatPkr(
                      calcLineDiscount(draft.qty, draft.rate, draft.discount),
                    )}
                  </p>
                ) : null}
              </td>
              <td className="font-medium text-[var(--muted)]">
                {formatPkr(draftAmount)}
              </td>
              <td>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="px-2"
                  onClick={() => commitDraft()}
                  title="Add line (or press Enter on Discount %)"
                >
                  Add
                </Button>
              </td>
            </tr>

            {lines.length === 0 ? (
              <tr>
                <td
                  colSpan={enableBonus ? 8 : 7}
                  className="py-6 text-center text-sm text-[var(--muted)]"
                >
                  Added products appear here. Keep using the top row to add more.
                </td>
              </tr>
            ) : (
              lines.map((line, index) => (
                <tr key={line.key}>
                  <td className="w-28 min-w-[7rem]">
                    <Input
                      value={line.product_code}
                      readOnly
                      className="bg-[var(--surface-2)] px-2 font-medium tabular-nums"
                      tabIndex={-1}
                    />
                    <span className="sr-only">Line {index + 1}</span>
                  </td>
                  <td>
                    <div className="truncate px-1 text-sm font-medium">
                      {line.product_name || "—"}
                    </div>
                    {(() => {
                      const note = stockNoteFor(line.product_id);
                      const over = overstockAlert(
                        line.product_id,
                        line.qty,
                        line.bonus || "0",
                        line.key,
                      );
                      if (over) {
                        return (
                          <p className="px-1 text-[10px] font-medium text-rose-600">
                            {over}
                          </p>
                        );
                      }
                      if (!note || note.tone === "ok") return null;
                      return (
                        <p
                          className={cn(
                            "px-1 text-[10px]",
                            note.tone === "warn"
                              ? "text-amber-700"
                              : "text-rose-600",
                          )}
                        >
                          {note.text}
                        </p>
                      );
                    })()}
                  </td>
                  <td>
                    <QtyUnitControl
                      packing={productById.get(line.product_id)?.packing ?? 1}
                      unitType={productById.get(line.product_id)?.unit_type}
                      baseUnit={productById.get(line.product_id)?.base_unit}
                      qty={line.qty}
                      onQtyChange={(qty) => {
                        patchLine(line.key, {
                          qty,
                          ...schemeFields(line.scheme, qty, line.rate),
                        });
                      }}
                      onQtyKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          const next = enableBonus
                            ? (e.currentTarget
                                .closest("tr")
                                ?.querySelector(
                                  'input[data-line-scheme="1"]',
                                ) as HTMLInputElement | null)
                            : (e.currentTarget
                                .closest("tr")
                                ?.querySelector(
                                  'input[data-line-rate="1"]',
                                ) as HTMLInputElement | null);
                          focusField(next);
                        }
                      }}
                      compact
                    />
                  </td>
                  {enableBonus ? (
                    <td>
                      <Input
                        data-line-scheme="1"
                        value={line.scheme}
                        placeholder="+1"
                        onChange={(e) =>
                          patchLineWithScheme(
                            line.key,
                            e.target.value,
                            line.qty,
                            line.rate,
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            e.stopPropagation();
                            const rateInput = e.currentTarget
                              .closest("tr")
                              ?.querySelector(
                                'input[data-line-rate="1"]',
                              ) as HTMLInputElement | null;
                            focusField(rateInput);
                          }
                        }}
                      />
                      {Number(line.bonus) > 0 ? (
                        <p className="mt-1 text-[10px] text-[var(--muted)]">
                          +{line.bonus} free
                        </p>
                      ) : null}
                    </td>
                  ) : null}
                  <td>
                    <Input
                      data-line-rate="1"
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.rate}
                      onChange={(e) =>
                        patchLine(line.key, { rate: e.target.value })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          const disc = e.currentTarget
                            .closest("tr")
                            ?.querySelector(
                              'input[data-line-discount="1"]',
                            ) as HTMLInputElement | null;
                          focusField(disc);
                        }
                      }}
                    />
                    {lineHints[line.key] ? (
                      <p className="mt-1 text-[10px] text-[var(--brand)]">
                        {lineHints[line.key]}
                      </p>
                    ) : null}
                    {(() => {
                      const p = productById.get(line.product_id);
                      if (!p || !hasCartonPacking(p.packing)) return null;
                      return (
                        <p className="mt-1 text-[10px] text-[var(--muted)]">
                          {formatPkr(perCartonRate(line.rate, p.packing))}/
                          {(p.unit_type || "Carton").toLowerCase()}
                        </p>
                      );
                    })()}
                  </td>
                  <td>
                    <Input
                      data-line-discount="1"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={line.discount}
                      onChange={(e) =>
                        patchLine(line.key, { discount: e.target.value })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          focusField(codeRef.current);
                        }
                      }}
                    />
                    {Number(line.discount) > 0 ? (
                      <p className="mt-1 text-[10px] text-[var(--muted)]">
                        {formatPkr(
                          calcLineDiscount(line.qty, line.rate, line.discount),
                        )}
                      </p>
                    ) : null}
                  </td>
                  <td className="font-medium">{formatPkr(line.amount)}</td>
                  <td>
                    <button
                      type="button"
                      className="rounded-lg p-2 text-rose-600 hover:bg-rose-50"
                      onClick={() => removeLine(line.key)}
                      aria-label="Remove line"
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

      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-sm">
          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <span className="text-[var(--muted)]">
                Subtotal {formatPkr(subtotal)}
              </span>
              <span className="text-[var(--muted)]">
                Trade discount {formatPkr(discount)}
              </span>
            </div>
            {onExtraDiscountChange ? (
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <Label className="text-xs uppercase tracking-wide text-[var(--muted)]">
                  Extra discount
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={extraDiscount ?? ""}
                  onChange={(e) => onExtraDiscountChange(e.target.value)}
                  placeholder="0"
                  className="h-9 w-28 text-right tabular-nums"
                />
                <span className="min-w-[5rem] text-right text-[var(--muted)]">
                  {formatPkr(extra)}
                </span>
              </div>
            ) : null}
            <span className="font-semibold">
              Bill amount {formatPkr(onExtraDiscountChange ? billTotal : grand)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function summarizeLines(lines: LineItemDraft[]) {
  const subtotal = lines.reduce(
    (s, l) => s + Number(l.qty || 0) * Number(l.rate || 0),
    0,
  );
  const discount_total = lines.reduce(
    (s, l) => s + calcLineDiscount(l.qty, l.rate, l.discount),
    0,
  );
  const grand_total = lines.reduce((s, l) => s + l.amount, 0);
  return { subtotal, discount_total, grand_total };
}

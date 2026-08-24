"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  formatUom,
  fromPieces,
  hasCartonPacking,
  perCartonRate,
  toPieces,
} from "@/lib/pricing/uom";
import { computeLineScheme } from "@/lib/pricing/discounts";
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
  /** When set, picking a product auto-selects the warehouse that stocks it. */
  onAutoPickWarehouse,
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
}) {
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [hint, setHint] = useState<string | null>(null);
  const [lineHints, setLineHints] = useState<Record<string, string>>({});
  const [productOpen, setProductOpen] = useState(false);

  const linesRef = useRef(lines);
  const draftRef = useRef(draft);
  const codeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const rateRef = useRef<HTMLInputElement>(null);
  const discountRef = useRef<HTMLInputElement>(null);
  const bonusRef = useRef<HTMLInputElement>(null);
  const productSelectRef = useRef<SelectHandle>(null);

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!autoFocus) return;
    const t = requestAnimationFrame(() => focusField(codeRef.current));
    return () => cancelAnimationFrame(t);
  }, [autoFocus]);

  function bonusFromProduct(product: Product | null | undefined, qty: string, rate: string) {
    if (!enableBonus || !product?.scheme) {
      return { bonus: "0", scheme: product?.scheme || "" };
    }
    const result = computeLineScheme(product.scheme, qty, rate);
    return {
      bonus: String(result.freeQty || 0),
      scheme: product.scheme,
    };
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

  function applyCartons(line: LineItemDraft, packing: number, cartonsRaw: string) {
    const { pieces: loose } = fromPieces(line.qty, packing);
    const cartons = Math.max(0, Math.floor(Number(cartonsRaw || 0)));
    const qty = String(toPieces(cartons, loose, packing));
    const p = products.find((x) => x.id === line.product_id);
    const bonusFields = bonusFromProduct(p, qty, line.rate);
    patchLine(line.key, { qty, ...bonusFields });
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

  function formatStockQty(qty: number) {
    return Number.isInteger(qty)
      ? String(qty)
      : qty.toFixed(2).replace(/\.?0+$/, "");
  }

  type StockNote = { tone: "ok" | "warn" | "bad"; text: string };
  /** Where a product is stocked, relative to the currently selected warehouse. */
  function stockNoteFor(productId: string): StockNote | null {
    if (!stockByProduct || !productId) return null;
    const entries = stockByProduct.get(productId);
    if (!entries || entries.length === 0) {
      return { tone: "bad", text: "Out of stock in every warehouse" };
    }
    const inCurrent = warehouseId
      ? entries.find((e) => e.warehouseId === warehouseId)
      : undefined;
    if (inCurrent && inCurrent.qty > 0) {
      return {
        tone: "ok",
        text: `In stock: ${warehouseLabel(warehouseId)} · ${formatStockQty(inCurrent.qty)}`,
      };
    }
    const best = entries[0];
    return {
      tone: "warn",
      text: `In ${warehouseLabel(best.warehouseId)} · ${formatStockQty(best.qty)} — not in ${warehouseLabel(warehouseId)}`,
    };
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

    // Auto-pick the warehouse that stocks this product (sale invoice only).
    if (stockByProduct && onAutoPickWarehouse && catalog.id) {
      const entries = stockByProduct.get(catalog.id);
      const currentHasStock =
        !!warehouseId &&
        !!entries?.some((e) => e.warehouseId === warehouseId && e.qty > 0);
      if (entries?.length && !currentHasStock) {
        const best = entries[0];
        // Don't strand lines already stocked in the current warehouse.
        const safe = linesRef.current
          .filter((l) => l.product_id)
          .every((l) =>
            stockByProduct
              .get(l.product_id)
              ?.some((x) => x.warehouseId === best.warehouseId && x.qty > 0),
          );
        if (safe && best.warehouseId !== warehouseId) {
          onAutoPickWarehouse(best.warehouseId);
        }
      }
    }

    const current = draftRef.current;
    const qty = current && Number(current.qty) > 0 ? current.qty : "1";
    const { rate, hint: rateHint } = await resolveRate(catalog);
    const bonusFields = bonusFromProduct(catalog, qty, String(rate));

    patchDraft({
      product_id: catalog.id,
      product_code: catalog.code,
      product_name: catalog.name_en,
      qty,
      rate: String(rate),
      discount: current?.discount || "0",
      ...bonusFields,
    });
    setHint(
      bonusFields.scheme && Number(bonusFields.bonus) > 0
        ? `${rateHint} · Bonus ${bonusFields.scheme}`
        : rateHint,
    );
  }

  async function resolveProductCode(raw: string): Promise<Product | null> {
    const trimmed = raw.trim();
    if (!trimmed) {
      await applyProductToDraft(null);
      return null;
    }

    const local = products.find(
      (p) => p.code.toLowerCase() === trimmed.toLowerCase(),
    );
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
    patchDraft({ product_code: value });
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
      focusField(bonusRef.current);
      return;
    }
    focusField(rateRef.current);
  }

  function onBonusEnter(e: ReactKeyboardEvent<HTMLInputElement>) {
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
      <div className="rounded-xl border border-[var(--brand)]/30 bg-[var(--brand-soft)]/40 px-3 py-2 text-xs text-[var(--brand-strong)]">
        Keyboard: type <kbd className="rounded bg-white px-1">code</kbd> →{" "}
        <kbd className="rounded bg-white px-1">Enter</kbd> opens product → qty
        {enableBonus ? (
          <>
            {" "}
            → bonus
          </>
        ) : null}{" "}
        → rate → discount % → <kbd className="rounded bg-white px-1">Enter</kbd>{" "}
        adds the line. No need to click Add line.
      </div>

      <div className="table-grid">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr>
              <th className="w-24">Code</th>
              <th>Product</th>
              <th className="w-28">Qty</th>
              {enableBonus ? <th className="w-24">Bonus</th> : null}
              <th className="w-28">Rate</th>
              <th className="w-28">Discount %</th>
              <th className="w-28">Amount</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {/* Sticky quick-entry row */}
            <tr className="bg-[var(--brand-soft)]/25">
              <td>
                <Input
                  ref={codeRef}
                  value={draft.product_code}
                  placeholder="Code"
                  autoComplete="off"
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
                  open={productOpen}
                  onOpenChange={setProductOpen}
                  onChange={(e) => void onProductPicked(e.target.value)}
                />
                {(() => {
                  const note = stockNoteFor(draft.product_id);
                  if (!note) return null;
                  return (
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
                  );
                })()}
              </td>
              <td>
                <Input
                  ref={qtyRef}
                  type="number"
                  min="0"
                  step="0.1"
                  value={draft.qty}
                  onChange={(e) => {
                    const qty = e.target.value;
                    const p = productById.get(draftRef.current.product_id);
                    const bonusFields = bonusFromProduct(
                      p,
                      qty,
                      draftRef.current.rate,
                    );
                    patchDraft({ qty, ...bonusFields });
                  }}
                  onKeyDown={onQtyEnter}
                />
                {(() => {
                  const p = productById.get(draft.product_id);
                  if (!p || !hasCartonPacking(p.packing)) return null;
                  return (
                    <p className="mt-1 text-[10px] text-[var(--muted)]">
                      {formatUom(draft.qty, p.packing)}
                    </p>
                  );
                })()}
              </td>
              {enableBonus ? (
                <td>
                  <Input
                    ref={bonusRef}
                    type="number"
                    min="0"
                    step="0.1"
                    value={draft.bonus}
                    onChange={(e) => patchDraft({ bonus: e.target.value })}
                    onKeyDown={onBonusEnter}
                    title={draft.scheme ? `Scheme ${draft.scheme}` : "Bonus qty"}
                  />
                  {draft.scheme ? (
                    <p className="mt-1 text-[10px] text-[var(--muted)]">
                      {draft.scheme}
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
                  onChange={(e) => patchDraft({ rate: e.target.value })}
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
                  title="Add line (or press Enter on Discount)"
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
                  <td>
                    <Input
                      value={line.product_code}
                      readOnly
                      className="bg-[var(--surface-2)]"
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
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      value={line.qty}
                      onChange={(e) => {
                        const qty = e.target.value;
                        const p = productById.get(line.product_id);
                        const bonusFields = bonusFromProduct(p, qty, line.rate);
                        patchLine(line.key, { qty, ...bonusFields });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          const next = enableBonus
                            ? (e.currentTarget
                                .closest("tr")
                                ?.querySelector(
                                  'input[data-line-bonus="1"]',
                                ) as HTMLInputElement | null)
                            : (e.currentTarget
                                .closest("tr")
                                ?.querySelector(
                                  'input[data-line-rate="1"]',
                                ) as HTMLInputElement | null);
                          focusField(next);
                        }
                      }}
                    />
                    {(() => {
                      const p = productById.get(line.product_id);
                      if (!p || !hasCartonPacking(p.packing)) return null;
                      return (
                        <div className="mt-1 flex items-center gap-1">
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={fromPieces(line.qty, p.packing).cartons}
                            onChange={(e) =>
                              applyCartons(line, p.packing, e.target.value)
                            }
                            className="h-6 w-12 rounded border border-[var(--border)] px-1 text-[11px]"
                            aria-label="Cartons"
                            title={`Cartons — ${p.packing}/ctn`}
                          />
                          <span className="text-[10px] text-[var(--muted)]">
                            ctn · {formatUom(line.qty, p.packing)}
                          </span>
                        </div>
                      );
                    })()}
                  </td>
                  {enableBonus ? (
                    <td>
                      <Input
                        data-line-bonus="1"
                        type="number"
                        min="0"
                        step="0.1"
                        value={line.bonus}
                        onChange={(e) =>
                          patchLine(line.key, { bonus: e.target.value })
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
                      {line.scheme ? (
                        <p className="mt-1 text-[10px] text-[var(--muted)]">
                          {line.scheme}
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
                          {formatPkr(perCartonRate(line.rate, p.packing))}/ctn
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
          <div className="flex gap-6">
            <span className="text-[var(--muted)]">
              Subtotal {formatPkr(subtotal)}
            </span>
            <span className="text-[var(--muted)]">
              Discount {formatPkr(discount)}
            </span>
            <span className="font-semibold">Total {formatPkr(grand)}</span>
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

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
import { createClient } from "@/lib/supabase/client";
import type { Party, Product } from "@/lib/types/database";
import { AMOUNT_PLACEHOLDER, AMOUNT_STEP, formatNumber, formatPkr } from "@/lib/utils";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

type Line = {
  product_id: string;
  product_code: string;
  product_name: string;
  history_qty: number;
  history_amount: number;
  qty: string;
  rate: string;
  discountPct: string;
  amount: string;
};

function money(value: number) {
  return Math.round(Math.max(0, value) * 100) / 100;
}

function recoverAmount(qty: number, rate: number, discountPct: number) {
  const gross = qty * rate;
  const cut = Math.min(gross, (gross * Math.min(Math.max(discountPct, 0), 100)) / 100);
  return money(Math.max(0, gross - cut));
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function ExpiryReceiptForm({
  companyId,
  organizationId,
  parties,
  products,
  onDone,
}: {
  companyId: string;
  organizationId: string;
  parties: Party[];
  products: Product[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  useDialogInvoiceNo(companyId, "expiry_receipt");
  const customers = useMemo(
    () =>
      parties.filter(
        (p) =>
          p.party_subtype === "customer" ||
          p.party_subtype === "both" ||
          p.party_type === "PARTY",
      ),
    [parties],
  );

  const [customerMode, setCustomerMode] = useState<"customer" | "none">("customer");
  const [partyId, setPartyId] = useState("");
  const [gstMode, setGstMode] = useState<"percent" | "amount">("amount");
  const [gstInput, setGstInput] = useState("");
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [periodFrom, setPeriodFrom] = useState(daysAgo(90));
  const [periodTo, setPeriodTo] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [draftCode, setDraftCode] = useState("");
  const [draftProductId, setDraftProductId] = useState("");
  const [draftQty, setDraftQty] = useState("1");
  const [draftRateText, setDraftRateText] = useState("");
  const [draftDiscount, setDraftDiscount] = useState("");
  const [draftRate, setDraftRate] = useState<number>(0);
  const [hint, setHint] = useState<string | null>(null);

  const codeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const discountRef = useRef<HTMLInputElement>(null);
  const productSelectRef = useRef<SelectHandle>(null);

  /** Old/manual sale: credit shop balance only — do not add to expiry stock for claim. */
  const [balanceOnly, setBalanceOnly] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const singleSubmit = useSingleSubmit();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (customerMode !== "customer" || !partyId || !periodFrom || !periodTo) {
      return;
    }
    const handle = window.setTimeout(async () => {
      setLoadingHistory(true);
      setError(null);
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc(
        "get_customer_sale_history",
        {
          p_company_id: companyId,
          p_party_id: partyId,
          p_from: periodFrom,
          p_to: periodTo,
        },
      );
      setLoadingHistory(false);
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      setLines(
        (data || []).map((row: {
          product_id: string;
          product_code: string;
          product_name: string;
          qty: number;
          amount: number;
        }) => ({
          product_id: row.product_id,
          product_code: row.product_code,
          product_name: row.product_name,
          history_qty: Number(row.qty || 0),
          history_amount: Number(row.amount || 0),
          qty: "",
          rate:
            Number(row.qty || 0) > 0
              ? String(money(Number(row.amount || 0) / Number(row.qty || 0)))
              : "",
          discountPct: "",
          amount: "",
        })),
      );
    }, 250);
    return () => window.clearTimeout(handle);
  }, [companyId, customerMode, partyId, periodFrom, periodTo]);

  const enteredLines = lines.filter((l) => Number(l.qty) > 0);
  const enteredCount = enteredLines.length;
  const enteredQty = enteredLines.reduce(
    (sum, line) => sum + (Number(line.qty) || 0),
    0,
  );
  const subtotal = enteredLines.reduce((sum, line) => {
    return (
      sum +
      recoverAmount(Number(line.qty) || 0, Number(line.rate) || 0, Number(line.discountPct) || 0)
    );
  }, 0);
  const gstValue = Math.max(0, Number(gstInput) || 0);
  const gstAmount =
    gstMode === "percent"
      ? money(Math.min(subtotal, (subtotal * Math.min(gstValue, 100)) / 100))
      : money(Math.min(subtotal, gstValue));
  const netTotal = money(Math.max(0, subtotal - gstAmount));
  const withCustomer = customerMode === "customer" && Boolean(partyId);

  function patchLine(productId: string, patch: Partial<Line>) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.product_id !== productId) return l;
        const next = { ...l, ...patch };
        const amount = recoverAmount(
          Number(next.qty) || 0,
          Number(next.rate) || 0,
          Number(next.discountPct) || 0,
        );
        return { ...next, amount: amount > 0 ? String(amount) : "" };
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
      setHint(null);
      return;
    }
    const inHistory = lines.find((l) => l.product_id === p.id);
    const historyRate =
      inHistory && inHistory.history_qty > 0
        ? inHistory.history_amount / inHistory.history_qty
        : 0;
    const rate = historyRate > 0 ? historyRate : Number(p.sale_rate || 0);

    setDraftProductId(p.id);
    setDraftCode(p.code);
    setDraftRate(rate);
    setDraftRateText(rate > 0 ? String(money(rate)) : "");
    setHint(null);
    requestAnimationFrame(() => {
      qtyRef.current?.focus();
      qtyRef.current?.select();
    });
  }

  const draftRecover = recoverAmount(
    Number(draftQty) || 0,
    Number(draftRateText || draftRate) || 0,
    Number(draftDiscount) || 0,
  );

  function commitDraft() {
    const product =
      products.find((p) => p.id === draftProductId) ||
      (draftCode.trim() ? findProductByCodeOrBarcode(products, draftCode.trim()) : null);
    if (!product) {
      setHint("Select a product to add");
      codeRef.current?.focus();
      return;
    }
    const qty = draftQty.trim() ? draftQty.trim() : "1";
    const numQty = Number(qty);
    if (!(numQty > 0)) {
      setHint("Enter a return qty");
      qtyRef.current?.focus();
      return;
    }
    const rate = Number(draftRateText) > 0 ? Number(draftRateText) : draftRate || Number(product.sale_rate || 0);
    const amount = recoverAmount(numQty, rate, Number(draftDiscount) || 0);

    setLines((prev) => {
      const idx = prev.findIndex((l) => l.product_id === product.id);
      const row: Line = {
        product_id: product.id,
        product_code: product.code,
        product_name: product.name_en,
        history_qty: prev[idx]?.history_qty || 0,
        history_amount: prev[idx]?.history_amount || 0,
        qty,
        rate: rate > 0 ? String(money(rate)) : "",
        discountPct: draftDiscount,
        amount: amount > 0 ? String(amount) : "",
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
    setDraftRateText("");
    setDraftDiscount("");
    setDraftRate(0);
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
    const found = findProductByCodeOrBarcode(products, trimmed);
    if (found) {
      applyProduct(found);
    } else {
      setHint("No product for this code or barcode");
      productSelectRef.current?.open(trimmed);
    }
  }

  function onDraftQtyKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      discountRef.current?.focus();
      discountRef.current?.select();
    }
  }

  function onDraftDiscountKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      commitDraft();
    }
  }

  function removeLine(productId: string) {
    setLines((prev) => prev.filter((l) => l.product_id !== productId));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await singleSubmit(async () => {
    setError(null);
    const valid = lines.filter(
      (l) => l.product_id && (Number(l.qty) > 0 || Number(l.amount) > 0),
    );
    if (customerMode === "customer" && !partyId) {
      setError("Select a customer, or switch to No customer.");
      return;
    }
    if (valid.length === 0) {
      setError("Add at least one expired item with a quantity.");
      return;
    }
    if (balanceOnly && customerMode === "none") {
      setError("Old-sale balance return needs a customer.");
      return;
    }
    if (balanceOnly && netTotal <= 0.005) {
      setError(
        "Balance-only return needs a recover amount. Enter the rupees to cut from this shop’s balance.",
      );
      return;
    }

    setLoading(true);
    try {
      const res = await offlineAwareSubmit({
        mutationType: "expiry_receipt",
        companyId,
        organizationId,
        payload: {
          organization_id: organizationId,
          company_id: companyId,
          receipt_date: receiptDate,
          party_id: withCustomer ? partyId : null,
          balance_only: withCustomer && balanceOnly,
          gst_mode: gstMode,
          gst_input: gstValue,
          parties: (() => {
            const customer = withCustomer ? parties.find((p) => p.id === partyId) : null;
            return customer
              ? {
                  name_en: customer.name_en,
                  party_code: customer.party_code,
                  phone: customer.phone,
                  mobile: customer.mobile,
                  contact_person: customer.contact_person,
                }
              : null;
          })(),
          period_from: periodFrom,
          period_to: periodTo,
          subtotal: subtotal,
          grand_total: netTotal,
          narration,
          items: valid.map((l) => {
            const qty = Number(l.qty) || 0;
            const rate = Number(l.rate) || 0;
            const discount = Number(l.discountPct) || 0;
            return {
              product_id: l.product_id,
              product_code: l.product_code,
              product_name: l.product_name,
              history_qty: l.history_qty,
              history_amount: l.history_amount,
              qty,
              rate,
              discount_percent: discount,
              amount: recoverAmount(qty, rate, discount),
            };
          }),
        },
      });

      setLoading(false);
      closeDialog?.();
      onDone?.();
      if (res.source === "offline") {
        router.refresh();
      } else {
        router.push(`/inventory/expiry/receipts/${res.id}`);
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
            value={receiptDate}
            onChange={(e) => setReceiptDate(e.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <Label>Customer</Label>
          <div className="mb-2 inline-flex rounded-md border border-[var(--border)] p-0.5 text-xs font-semibold">
            <button
              type="button"
              className={`rounded px-2 py-1 ${customerMode === "customer" ? "bg-[var(--brand)] text-white" : "text-[var(--muted)]"}`}
              onClick={() => setCustomerMode("customer")}
            >
              Select customer
            </button>
            <button
              type="button"
              className={`rounded px-2 py-1 ${customerMode === "none" ? "bg-[var(--brand)] text-white" : "text-[var(--muted)]"}`}
              onClick={() => {
                setCustomerMode("none");
                setPartyId("");
                setBalanceOnly(false);
              }}
            >
              No customer
            </button>
          </div>
          {customerMode === "customer" ? (
            <PartyCodePicker
              companyId={companyId}
              parties={customers}
              value={partyId}
              label="Customer code"
              emptyLabel="Select customer"
              filterSubtype={["customer", "both"]}
              onChange={(id) => setPartyId(id)}
            />
          ) : (
            <p className="flex h-10 items-center gap-2 text-sm text-[var(--muted)]">
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                No party
              </span>
              Saved on expiry stock only. No customer ledger is cut.
            </p>
          )}
        </div>
        <div>
          <Label>Sold from</Label>
          <Input
            type="date"
            value={periodFrom}
            onChange={(e) => setPeriodFrom(e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Sold to</Label>
          <Input
            type="date"
            value={periodTo}
            onChange={(e) => setPeriodTo(e.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Narration / reason</Label>
          <Input
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="Expired stock returned by shop"
          />
        </div>
      </div>

      <p className="text-sm text-[var(--muted)]">
        {customerMode === "none"
          ? "No customer: the return is recorded and qty goes to expiry stock for vendor claim. Nothing is cut from a shop ledger."
          : loadingHistory
            ? "Loading this customer’s billed items for the selected dates…"
            : partyId
              ? balanceOnly
                ? "Old/manual sale: recover amount cuts this shop’s ledger. Qty is not added to expiry stock, so it cannot be claimed from a company."
                : "Price minus discount % is the recover amount. That net, after GST, is cut from this customer’s ledger. Qty goes to expiry stock for vendor claim."
              : "Choose a customer, or use No customer if this return should not touch a ledger."}
      </p>

      {customerMode === "customer" ? (
      <label className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2,#f8f8f8)] px-3 py-2.5 text-sm">
        <input
          type="checkbox"
          checked={balanceOnly}
          onChange={(e) => setBalanceOnly(e.target.checked)}
          className="mt-0.5 rounded border-[var(--border)]"
        />
        <span>
          <span className="font-medium text-[var(--ink)]">
            Old sale (no software invoice) — balance only
          </span>
          <span className="mt-0.5 block text-[var(--muted)]">
            Cut customer balance by the recover amount. Do not put these items into
            expiry stock. Use normal mode (unchecked) when goods should go to expiry
            stock for company claim.
          </span>
        </span>
      </label>
      ) : null}

      <div className="table-grid table-grid--y-scroll">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr>
              <th className="w-28 min-w-[6.5rem]">Code</th>
              <th className="min-w-[12rem]">Product</th>
              <th className="w-28">Price</th>
              <th className="w-24">Disc %</th>
              <th className="w-24">Qty</th>
              <th className="w-32">Recover</th>
              <th className="w-12 text-center" />
            </tr>
          </thead>
          <tbody>
            {/* In-row quick entry row */}
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
                    const p = products.find((x) => x.id === e.target.value);
                    applyProduct(p || null);
                  }}
                  options={[
                    { value: "", label: "Select product" },
                    ...products.map((p) => ({
                      value: p.id,
                      label: `${p.code} — ${p.name_en}`,
                      meta: productPieceRateMeta(p, "sale_rate"),
                    })),
                  ]}
                />
                {hint ? (
                  <p className="mt-0.5 text-[10px] text-rose-600">{hint}</p>
                ) : null}
              </td>
              <td>
                <Input
                  type="number"
                  min="0"
                  step={AMOUNT_STEP}
                  placeholder="Price"
                  value={draftRateText}
                  className="h-8 px-2 text-sm"
                  onChange={(e) => setDraftRateText(e.target.value)}
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
              <td className="px-3 py-2 text-right text-sm font-medium tabular-nums">
                {draftRecover > 0 ? formatPkr(draftRecover) : "—"}
              </td>
              <td className="text-center">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-8 px-2.5 text-xs"
                  onClick={commitDraft}
                  title="Add product (or press Enter on Recover amount)"
                >
                  Add
                </Button>
              </td>
            </tr>

            {lines.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="py-4 text-center text-sm text-[var(--muted)]"
                >
                  Added products appear here. Keep using the top row to add more.
                </td>
              </tr>
            ) : (
              lines.map((l) => (
                <tr key={l.product_id}>
                  <td className="px-3 py-2 font-medium tabular-nums text-[var(--muted)]">
                    {l.product_code}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {l.product_name}
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      type="number"
                      min="0"
                      step={AMOUNT_STEP}
                      value={l.rate}
                      onChange={(e) => patchLine(l.product_id, { rate: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={l.discountPct}
                      onChange={(e) =>
                        patchLine(l.product_id, { discountPct: e.target.value })
                      }
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={l.qty}
                      onChange={(e) => patchLine(l.product_id, { qty: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatPkr(Number(l.amount) || 0)}
                  </td>
                  <td className="px-2 py-1 text-center">
                    <button
                      type="button"
                      className="rounded-lg p-1 text-[var(--muted)] hover:bg-rose-50 hover:text-rose-600 transition-colors"
                      onClick={() => removeLine(l.product_id)}
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
          <p className="font-semibold">{formatNumber(enteredCount, 0)} products</p>
          <p className="text-[var(--muted)]">Total qty {formatNumber(enteredQty, 0)}</p>
          <p>Recover {formatPkr(subtotal)}</p>
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
            {withCustomer ? `Cut from ledger ${formatPkr(netTotal)}` : `Bill ${formatPkr(netTotal)} · No party`}
          </p>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <Button type="submit" loading={loading}>
        {loading ? "Posting..." : "Save customer expiry return"}
      </Button>
    </form>
  );
}

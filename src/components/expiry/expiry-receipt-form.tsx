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
  amount: string;
};

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

  const [partyId, setPartyId] = useState("");
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [periodFrom, setPeriodFrom] = useState(daysAgo(90));
  const [periodTo, setPeriodTo] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [draftCode, setDraftCode] = useState("");
  const [draftProductId, setDraftProductId] = useState("");
  const [draftQty, setDraftQty] = useState("1");
  const [draftAmount, setDraftAmount] = useState("");
  const [draftRate, setDraftRate] = useState<number>(0);
  const [hint, setHint] = useState<string | null>(null);

  const codeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const productSelectRef = useRef<SelectHandle>(null);

  /** Old/manual sale: credit shop balance only — do not add to expiry stock for claim. */
  const [balanceOnly, setBalanceOnly] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const singleSubmit = useSingleSubmit();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!partyId || !periodFrom || !periodTo) {
      setLines([]);
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
          amount: "",
        })),
      );
    }, 250);
    return () => window.clearTimeout(handle);
  }, [companyId, partyId, periodFrom, periodTo]);

  const grandTotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const enteredLines = lines.filter(
    (l) => Number(l.qty) > 0 || Number(l.amount) > 0,
  );
  const enteredCount = enteredLines.length;
  const enteredQty = enteredLines.reduce(
    (sum, line) => sum + (Number(line.qty) || 0),
    0,
  );

  function patchLine(productId: string, patch: Partial<Line>) {
    setLines((prev) =>
      prev.map((l) => (l.product_id === productId ? { ...l, ...patch } : l)),
    );
  }

  function onReturnQtyChange(line: Line, raw: string) {
    const qty = Number(raw);
    const rate =
      line.history_qty > 0 ? line.history_amount / line.history_qty : 0;
    const amount =
      Number.isFinite(qty) && qty > 0 && rate > 0
        ? String(Math.round(qty * rate * 100) / 100)
        : qty > 0
          ? line.amount
          : "";
    patchLine(line.product_id, { qty: raw, amount });
  }

  function applyProduct(p: Product | null) {
    if (!p) {
      setDraftProductId("");
      setDraftCode("");
      setDraftRate(0);
      setDraftAmount("");
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
    const qty = Number(draftQty) > 0 ? Number(draftQty) : 1;
    setDraftAmount(rate > 0 ? String(Math.round(qty * rate * 100) / 100) : "");
    setHint(null);
    requestAnimationFrame(() => {
      qtyRef.current?.focus();
      qtyRef.current?.select();
    });
  }

  function onDraftQtyChange(raw: string) {
    setDraftQty(raw);
    const qty = Number(raw);
    if (draftRate > 0 && Number.isFinite(qty) && qty > 0) {
      setDraftAmount(String(Math.round(qty * draftRate * 100) / 100));
    } else if (!raw) {
      setDraftAmount("");
    }
  }

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
    const rate = draftRate > 0 ? draftRate : Number(product.sale_rate || 0);
    const amount = draftAmount.trim()
      ? draftAmount.trim()
      : rate > 0
        ? String(Math.round(numQty * rate * 100) / 100)
        : "";

    setLines((prev) => {
      const idx = prev.findIndex((l) => l.product_id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = {
          ...next[idx],
          qty,
          amount,
        };
        return next;
      }
      return [
        {
          product_id: product.id,
          product_code: product.code,
          product_name: product.name_en,
          history_qty: 0,
          history_amount: 0,
          qty,
          amount,
        },
        ...prev,
      ];
    });

    setDraftCode("");
    setDraftProductId("");
    setDraftQty("1");
    setDraftAmount("");
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
      commitDraft();
    }
  }

  function onDraftAmountKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
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
    if (!partyId || valid.length === 0) {
      setError("Select a customer and at least one expired item (qty or amount).");
      return;
    }
    if (balanceOnly && grandTotal <= 0.005) {
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
          party_id: partyId,
          balance_only: balanceOnly,
          parties: (() => {
            const customer = parties.find((p) => p.id === partyId);
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
          subtotal: grandTotal,
          grand_total: grandTotal,
          narration,
          items: valid.map((l) => {
            const qty = Number(l.qty) || 0;
            const amount = Number(l.amount) || 0;
            return {
              product_id: l.product_id,
              product_code: l.product_code,
              product_name: l.product_name,
              history_qty: l.history_qty,
              history_amount: l.history_amount,
              qty,
              rate: qty > 0 ? Math.round((amount / qty) * 100) / 100 : 0,
              amount,
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
          <PartyCodePicker
            companyId={companyId}
            parties={customers}
            value={partyId}
            required
            label="Customer code"
            emptyLabel="Select customer"
            filterSubtype={["customer", "both"]}
            onChange={(id) => setPartyId(id)}
          />
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
        {loadingHistory
          ? "Loading this customer’s billed items for the selected dates…"
          : partyId
            ? balanceOnly
              ? "Old/manual sale mode: recover amount cuts this shop’s balance (Cr on ledger). Qty is for record only — nothing is added to expiry stock, so it will not appear for company claim."
              : "Search the billed list, then enter return qty. Recover amount credits this shop (reduces their balance). Qty also goes into expiry stock for company claim."
            : "Pick a customer — billed items for these dates load automatically."}
      </p>

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

      <div className="table-grid table-grid--y-scroll">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr>
              <th className="w-32 min-w-[7.5rem]">Code</th>
              <th className="min-w-[14rem]">Product</th>
              <th className="w-24">Sold qty</th>
              <th className="w-28">Sold amount</th>
              <th className="w-28">Return qty</th>
              <th className="w-32">Recover amount</th>
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
              <td className="px-3 py-2 text-center text-xs text-[var(--muted)] tabular-nums">
                —
              </td>
              <td className="px-3 py-2 text-center text-xs text-[var(--muted)] tabular-nums">
                —
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
                  onChange={(e) => onDraftQtyChange(e.target.value)}
                  onKeyDown={onDraftQtyKeyDown}
                />
              </td>
              <td>
                <Input
                  ref={amountRef}
                  type="number"
                  min="0"
                  step={AMOUNT_STEP}
                  placeholder={AMOUNT_PLACEHOLDER}
                  value={draftAmount}
                  className="h-8 px-2 text-sm"
                  onChange={(e) => setDraftAmount(e.target.value)}
                  onKeyDown={onDraftAmountKeyDown}
                />
              </td>
              <td className="text-center">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-8 px-2.5 text-xs"
                  onClick={commitDraft}
                  title="Add product (or press Enter on Return qty)"
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
                  <td className="px-3 py-2 tabular-nums text-[var(--muted)]">
                    {l.history_qty}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-[var(--muted)]">
                    {formatPkr(l.history_amount)}
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      placeholder=""
                      value={l.qty}
                      onChange={(e) => onReturnQtyChange(l, e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      type="number"
                      min="0"
                      step={AMOUNT_STEP}
                      placeholder={AMOUNT_PLACEHOLDER}
                      value={l.amount}
                      onChange={(e) =>
                        patchLine(l.product_id, { amount: e.target.value })
                      }
                    />
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

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="font-semibold">
          {formatNumber(enteredCount, 0)} products
        </span>
        <span className="text-[var(--muted)]">
          Total qty {formatNumber(enteredQty, 0)}
        </span>
        <span className="font-semibold">
          Credit customer {formatPkr(grandTotal)}
        </span>
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

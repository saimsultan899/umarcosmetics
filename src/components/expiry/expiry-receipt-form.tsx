"use client";

import { PartyCodePicker } from "@/components/forms/party-code-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import { createClient } from "@/lib/supabase/client";
import type { Party, Product } from "@/lib/types/database";
import { formatPkr } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

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
}: {
  companyId: string;
  organizationId: string;
  parties: Party[];
  products: Product[];
}) {
  const router = useRouter();
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
  const [addProductId, setAddProductId] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [onlyEntered, setOnlyEntered] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!partyId || !periodFrom || !periodTo) {
      setLines([]);
      return;
    }
    setProductQuery("");
    setOnlyEntered(false);
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
  const enteredCount = lines.filter(
    (l) => Number(l.qty) > 0 || Number(l.amount) > 0,
  ).length;

  const visibleLines = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    return lines.filter((l) => {
      if (onlyEntered && !(Number(l.qty) > 0 || Number(l.amount) > 0)) {
        return false;
      }
      if (!q) return true;
      return (
        l.product_code.toLowerCase().includes(q) ||
        l.product_name.toLowerCase().includes(q)
      );
    });
  }, [lines, onlyEntered, productQuery]);

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

  function addProduct() {
    const product = products.find((p) => p.id === addProductId);
    if (!product) return;
    if (lines.some((l) => l.product_id === product.id)) {
      setAddProductId("");
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        product_id: product.id,
        product_code: product.code,
        product_name: product.name_en,
        history_qty: 0,
        history_amount: 0,
        qty: "1",
        amount: String(Number(product.sale_rate || 0)),
      },
    ]);
    setAddProductId("");
    setProductQuery(product.code);
    setOnlyEntered(false);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const valid = lines.filter(
      (l) => l.product_id && (Number(l.qty) > 0 || Number(l.amount) > 0),
    );
    if (!partyId || valid.length === 0) {
      setError("Select a customer and at least one expired item (qty or amount).");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_expiry_receipt", {
      p_payload: {
        organization_id: organizationId,
        company_id: companyId,
        receipt_date: receiptDate,
        party_id: partyId,
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
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    router.push(`/inventory/expiry/receipts/${data}`);
    router.refresh();
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
            ? "Search the billed list, then enter return qty. Recover amount is the rupees credited to this shop (it reduces their balance). It fills from the original bill rate — you can change it."
            : "Pick a customer — billed items for these dates load automatically."}
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <Label>Search products</Label>
          <Input
            value={productQuery}
            onChange={(e) => setProductQuery(e.target.value)}
            placeholder="Code or item name"
          />
        </div>
        <label className="flex h-10 items-center gap-2 text-sm text-[var(--muted)]">
          <input
            type="checkbox"
            checked={onlyEntered}
            onChange={(e) => setOnlyEntered(e.target.checked)}
            className="rounded border-[var(--border)]"
          />
          Only entered lines
        </label>
        <p className="text-xs text-[var(--muted)]">
          Showing {visibleLines.length} of {lines.length}
          {enteredCount ? ` · ${enteredCount} to post` : ""}
        </p>
      </div>

      <div className="table-grid table-grid--y-scroll">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr>
              <th>Item</th>
              <th className="w-28">Sold qty</th>
              <th className="w-32">Sold amount</th>
              <th className="w-28">Return qty</th>
              <th className="w-36">Recover amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-[var(--muted)]">
                  No billed items in this date range. Add a product below if needed.
                </td>
              </tr>
            ) : visibleLines.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-[var(--muted)]">
                  No products match this search. Clear the filter or add a product below.
                </td>
              </tr>
            ) : (
              visibleLines.map((l) => (
                <tr key={l.product_id}>
                  <td className="px-3 py-2">
                    {l.product_code} {l.product_name}
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
                      step="0.001"
                      value={l.qty}
                      onChange={(e) => onReturnQtyChange(l, e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={l.amount}
                      onChange={(e) =>
                        patchLine(l.product_id, { amount: e.target.value })
                      }
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[16rem] flex-1">
          <Label>Add another product</Label>
          <Select
            value={addProductId}
            onChange={(e) => setAddProductId(e.target.value)}
            options={[
              { value: "", label: "Select product" },
              ...products.map((p) => ({
                value: p.id,
                label: `${p.code} — ${p.name_en}`,
              })),
            ]}
          />
        </div>
        <Button type="button" variant="secondary" onClick={addProduct}>
          Add
        </Button>
        <span className="ml-auto font-semibold">
          Credit customer {formatPkr(grandTotal)}
        </span>
      </div>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <Button type="submit" disabled={loading}>
        {loading ? "Posting..." : "Save customer expiry return"}
      </Button>
    </form>
  );
}

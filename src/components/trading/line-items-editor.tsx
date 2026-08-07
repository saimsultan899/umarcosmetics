"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  rateSourceLabel,
  resolveProductRate,
  type RateField,
} from "@/lib/product-rate";
import { createClient } from "@/lib/supabase/client";
import type { Product } from "@/lib/types/database";
import {
  calcLineAmount,
  emptyLine,
  type LineItemDraft,
} from "@/lib/types/trading";
import { formatPkr } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export function LineItemsEditor({
  products,
  lines,
  onChange,
  rateField = "sale_rate",
  companyId,
  partyId,
}: {
  products: Product[];
  lines: LineItemDraft[];
  onChange: (lines: LineItemDraft[]) => void;
  rateField?: RateField;
  companyId?: string;
  partyId?: string;
}) {
  const [hints, setHints] = useState<Record<string, string>>({});
  const linesRef = useRef(lines);
  const codeTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

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
    let hint = rateSourceLabel(product, rateField, rate);

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
          hint = "Auto · Last rate for this party";
        }
      } catch {
        // Keep catalog rate if RPC unavailable offline
      }
    }

    return { rate, hint };
  }

  async function applyProduct(key: string, p: Product | null) {
    if (!p) {
      patchLine(key, {
        product_id: "",
        product_code: "",
        product_name: "",
        rate: "0",
      });
      setHints((h) => {
        const next = { ...h };
        delete next[key];
        return next;
      });
      return;
    }

    // Prefer full local catalog row so rates are complete after code lookup
    const catalog =
      products.find((x) => x.id === p.id) ||
      products.find(
        (x) => x.code.toLowerCase() === String(p.code || "").toLowerCase(),
      ) ||
      p;

    const current = linesRef.current.find((l) => l.key === key);
    const qty =
      current && Number(current.qty) > 0 ? current.qty : "1";
    const { rate, hint } = await resolveRate(catalog);

    patchLine(key, {
      product_id: catalog.id,
      product_code: catalog.code,
      product_name: catalog.name_en,
      qty,
      rate: String(rate),
      discount: current?.discount || "0",
    });
    setHints((h) => ({ ...h, [key]: hint }));
  }

  async function pickProduct(key: string, productId: string) {
    const p = products.find((x) => x.id === productId) || null;
    await applyProduct(key, p);
  }

  async function resolveProductCode(key: string, raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      await applyProduct(key, null);
      return;
    }

    const local = products.find(
      (p) => p.code.toLowerCase() === trimmed.toLowerCase(),
    );
    if (local) {
      await applyProduct(key, local);
      return;
    }

    if (!companyId) {
      setHints((h) => ({ ...h, [key]: "No product for this code" }));
      return;
    }

    const supabase = createClient();
    const { data } = await supabase.rpc("get_product_by_code", {
      p_company_id: companyId,
      p_code: trimmed,
    });
    const product = Array.isArray(data) ? data[0] : data;
    if (product) {
      await applyProduct(key, product as Product);
    } else {
      setHints((h) => ({ ...h, [key]: "No product for this code" }));
    }
  }

  function queueCodeResolve(key: string, value: string) {
    patchLine(key, { product_code: value });
    if (codeTimers.current[key]) clearTimeout(codeTimers.current[key]);
    codeTimers.current[key] = setTimeout(() => {
      void resolveProductCode(key, value);
    }, 350);
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
        const product =
          products.find((p) => p.id === line.product_id) || null;
        if (!product) continue;
        const { rate, hint } = await resolveRate(product);
        if (cancelled) return;
        patchLine(line.key, { rate: String(rate) });
        setHints((h) => ({ ...h, [line.key]: hint }));
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
  const discount = lines.reduce((s, l) => s + Number(l.discount || 0), 0);
  const grand = lines.reduce((s, l) => s + l.amount, 0);

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
    <div className="space-y-3">
      <div className="table-grid">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr>
              <th className="w-24">Code</th>
              <th>Product</th>
              <th className="w-24">Qty</th>
              <th className="w-28">Rate</th>
              <th className="w-28">Discount</th>
              <th className="w-28">Amount</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key}>
                <td>
                  <Input
                    value={line.product_code}
                    placeholder="Code"
                    onChange={(e) => queueCodeResolve(line.key, e.target.value)}
                    onBlur={() =>
                      void resolveProductCode(line.key, line.product_code)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void resolveProductCode(line.key, line.product_code);
                      }
                    }}
                  />
                </td>
                <td>
                  <Select
                    size="sm"
                    value={line.product_id}
                    options={productOptions}
                    onChange={(e) => void pickProduct(line.key, e.target.value)}
                  />
                </td>
                <td>
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={line.qty}
                    onChange={(e) =>
                      patchLine(line.key, { qty: e.target.value })
                    }
                  />
                </td>
                <td>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.rate}
                    onChange={(e) =>
                      patchLine(line.key, { rate: e.target.value })
                    }
                  />
                  {hints[line.key] ? (
                    <p className="mt-1 text-[10px] text-[var(--brand)]">
                      {hints[line.key]}
                    </p>
                  ) : null}
                </td>
                <td>
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={line.discount}
                    onChange={(e) =>
                      patchLine(line.key, { discount: e.target.value })
                    }
                  />
                </td>
                <td className="font-medium">{formatPkr(line.amount)}</td>
                <td>
                  <button
                    type="button"
                    className="rounded-lg p-2 text-rose-600 hover:bg-rose-50"
                    onClick={() => {
                      if (lines.length <= 1) {
                        const blank = emptyLine();
                        onChange([blank]);
                        setHints({});
                        return;
                      }
                      setHints((h) => {
                        const next = { ...h };
                        delete next[line.key];
                        return next;
                      });
                      onChange(lines.filter((l) => l.key !== line.key));
                    }}
                    aria-label="Remove line"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onChange([...lines, emptyLine()])}
        >
          <Plus className="h-4 w-4" />
          Add line
        </Button>
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
    (s, l) => s + Number(l.discount || 0),
    0,
  );
  const grand_total = lines.reduce((s, l) => s + l.amount, 0);
  return { subtotal, discount_total, grand_total };
}

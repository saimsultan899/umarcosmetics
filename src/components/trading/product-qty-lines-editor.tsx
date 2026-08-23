"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, type SelectHandle } from "@/components/ui/select";
import { focusField } from "@/lib/keyboard/enter-nav";
import type { Product } from "@/lib/types/database";
import { Trash2 } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

export type ProductQtyLine = {
  key: string;
  product_id: string;
  product_code: string;
  product_name: string;
  qty: string;
};

export function emptyProductQtyLine(): ProductQtyLine {
  return {
    key: crypto.randomUUID(),
    product_id: "",
    product_code: "",
    product_name: "",
    qty: "1",
  };
}

/**
 * Sticky code→product→qty entry for load sheets / transfers.
 * Enter advances fields; Enter on qty commits the line and returns to code.
 */
export function ProductQtyLinesEditor({
  products,
  lines,
  onChange,
  autoFocus = true,
}: {
  products: Product[];
  lines: ProductQtyLine[];
  onChange: (lines: ProductQtyLine[]) => void;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState<ProductQtyLine>(emptyProductQtyLine);
  const [hint, setHint] = useState<string | null>(null);
  const [productOpen, setProductOpen] = useState(false);

  const linesRef = useRef(lines);
  const draftRef = useRef(draft);
  const codeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
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

  function patchDraft(patch: Partial<ProductQtyLine>) {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      draftRef.current = next;
      return next;
    });
  }

  function applyProduct(p: Product | null) {
    if (!p) {
      patchDraft({
        product_id: "",
        product_code: "",
        product_name: "",
      });
      setHint(null);
      return;
    }
    const current = draftRef.current;
    patchDraft({
      product_id: p.id,
      product_code: p.code,
      product_name: p.name_en,
      qty: Number(current.qty) > 0 ? current.qty : "1",
    });
    setHint(null);
  }

  function resolveCode(raw: string): Product | null {
    const trimmed = raw.trim();
    if (!trimmed) {
      applyProduct(null);
      return null;
    }
    const local = products.find(
      (p) => p.code.toLowerCase() === trimmed.toLowerCase(),
    );
    if (local) {
      applyProduct(local);
      return local;
    }
    patchDraft({ product_code: trimmed });
    setHint("No product for this code");
    return null;
  }

  function setCodeValue(value: string) {
    patchDraft({ product_code: value });
    if (!value.trim()) setHint(null);
  }

  function resetDraft() {
    const next = emptyProductQtyLine();
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
      return;
    }
    const committed: ProductQtyLine = {
      ...current,
      key: crypto.randomUUID(),
    };
    const next = [...linesRef.current, committed];
    linesRef.current = next;
    onChange(next);
    resetDraft();
    requestAnimationFrame(() => focusField(codeRef.current));
  }

  function onCodeEnter(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    const found = resolveCode(draftRef.current.product_code);
    if (found) {
      focusField(qtyRef.current);
      return;
    }
    setProductOpen(true);
    productSelectRef.current?.open(draftRef.current.product_code);
  }

  function onProductPicked(productId: string) {
    const p = products.find((x) => x.id === productId) || null;
    applyProduct(p);
    if (p) requestAnimationFrame(() => focusField(qtyRef.current));
  }

  function onQtyEnter(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    commitDraft();
  }

  function removeLine(key: string) {
    const next = lines.filter((l) => l.key !== key);
    linesRef.current = next;
    onChange(next);
    requestAnimationFrame(() => focusField(codeRef.current));
  }

  return (
    <div className="space-y-2" data-enter-own>
      <p className="text-xs text-[var(--muted)]">
        Code → Enter → product dropdown → qty → Enter adds the line. Cursor
        returns to code for the next item.
      </p>
      <div className="table-grid">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="bg-[var(--surface-2)] text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
              <th className="w-24 px-3 py-2">Code</th>
              <th className="px-3 py-2">Product</th>
              <th className="w-28 px-3 py-2">Qty</th>
              <th className="w-12 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            <tr className="bg-[var(--brand-soft)]/25">
              <td className="px-3 py-2">
                <Input
                  ref={codeRef}
                  value={draft.product_code}
                  placeholder="Code"
                  autoComplete="off"
                  onChange={(e) => setCodeValue(e.target.value)}
                  onKeyDown={onCodeEnter}
                />
              </td>
              <td className="px-3 py-2">
                <Select
                  ref={productSelectRef}
                  size="sm"
                  value={draft.product_id}
                  options={productOptions}
                  open={productOpen}
                  onOpenChange={setProductOpen}
                  onChange={(e) => onProductPicked(e.target.value)}
                />
                {hint ? (
                  <p className="mt-1 text-[10px] text-rose-700">{hint}</p>
                ) : null}
              </td>
              <td className="px-3 py-2">
                <Input
                  ref={qtyRef}
                  type="number"
                  min="0"
                  step="0.1"
                  value={draft.qty}
                  onChange={(e) => patchDraft({ qty: e.target.value })}
                  onKeyDown={onQtyEnter}
                />
              </td>
              <td className="px-3 py-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="px-2"
                  onClick={() => commitDraft()}
                >
                  Add
                </Button>
              </td>
            </tr>

            {lines.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-5 text-center text-sm text-[var(--muted)]"
                >
                  Added products appear here.
                </td>
              </tr>
            ) : (
              lines.map((line) => (
                <tr key={line.key} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2 font-medium">{line.product_code}</td>
                  <td className="px-3 py-2">{line.product_name}</td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      min="0"
                      step="0.1"
                      value={line.qty}
                      onChange={(e) => {
                        const next = lines.map((l) =>
                          l.key === line.key
                            ? { ...l, qty: e.target.value }
                            : l,
                        );
                        linesRef.current = next;
                        onChange(next);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          focusField(codeRef.current);
                        }
                      }}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="rounded-lg p-2 text-[var(--muted)] hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => removeLine(line.key)}
                      data-enter-skip
                      aria-label="Remove line"
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
    </div>
  );
}

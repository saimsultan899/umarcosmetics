"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AMOUNT_PLACEHOLDER, AMOUNT_STEP, cn, formatPkr } from "@/lib/utils";
import { useEffect, useId, useRef, useState } from "react";

export type ExtraDiscountMode = "amount" | "percent";

type ExtraDiscountControlProps = {
  /** Bill after trade discount — percent is taken from this. */
  baseAmount: number;
  /** Always stored / emitted as rupees. */
  value: string;
  onChange: (amountRs: string) => void;
  disabled?: boolean;
  className?: string;
};

function roundMoney(n: number) {
  return Math.round(Math.max(0, n) * 100) / 100;
}

function amountFromInput(
  mode: ExtraDiscountMode,
  input: string,
  baseAmount: number,
) {
  const n = Math.max(0, Number(input) || 0);
  if (mode === "percent") {
    return roundMoney(Math.min(baseAmount, (baseAmount * n) / 100));
  }
  return roundMoney(Math.min(baseAmount, n));
}

function percentFromAmount(amount: number, baseAmount: number) {
  if (baseAmount <= 0) return "0";
  const pct = roundMoney((amount / baseAmount) * 100);
  return String(pct);
}

/**
 * Document-level extra discount with Amount / % toggle
 * (same tab style as PCS / CTN on qty).
 */
export function ExtraDiscountControl({
  baseAmount,
  value,
  onChange,
  disabled,
  className,
}: ExtraDiscountControlProps) {
  const groupId = useId();
  const [mode, setMode] = useState<ExtraDiscountMode>("amount");
  const [input, setInput] = useState(value || "");
  const lastEmitted = useRef(value || "");

  const amount = amountFromInput(mode, input, baseAmount);

  function emit(nextAmount: number) {
    const str =
      nextAmount > 0 ? String(nextAmount) : input.trim() === "" ? "" : "0";
    if (str === lastEmitted.current) return;
    lastEmitted.current = str;
    onChange(str);
  }

  // Keep rupee amount in sync when % mode and the bill base changes.
  useEffect(() => {
    if (mode !== "percent") return;
    emit(amountFromInput("percent", input, baseAmount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseAmount, mode]);

  function setModeSafe(next: ExtraDiscountMode) {
    if (next === mode) return;
    const currentAmount = amountFromInput(mode, input, baseAmount);
    if (next === "percent") {
      setInput(percentFromAmount(currentAmount, baseAmount));
    } else {
      setInput(currentAmount > 0 ? String(currentAmount) : "");
    }
    setMode(next);
  }

  function onInputChange(raw: string) {
    setInput(raw);
    emit(amountFromInput(mode, raw, baseAmount));
  }

  return (
    <div className={cn("flex flex-col gap-1 sm:items-end", className)}>
      <Label className="text-xs uppercase tracking-wide text-[var(--muted)]">
        Extra discount
      </Label>
      <div
        className="inline-flex rounded-md border border-[var(--border)] p-0.5 text-[10px] font-semibold uppercase"
        role="group"
        aria-label="Extra discount type"
      >
        <button
          type="button"
          id={`${groupId}-pct`}
          disabled={disabled}
          onClick={() => setModeSafe("percent")}
          className={cn(
            "rounded px-1.5 py-0.5",
            mode === "percent"
              ? "bg-[var(--brand)] text-white"
              : "text-[var(--muted)] hover:text-[var(--ink)]",
          )}
        >
          %
        </button>
        <button
          type="button"
          id={`${groupId}-amt`}
          disabled={disabled}
          onClick={() => setModeSafe("amount")}
          className={cn(
            "rounded px-1.5 py-0.5",
            mode === "amount"
              ? "bg-[var(--brand)] text-white"
              : "text-[var(--muted)] hover:text-[var(--ink)]",
          )}
        >
          Amount
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <Input
          type="number"
          min="0"
          step={AMOUNT_STEP}
          inputMode="decimal"
          value={input}
          disabled={disabled}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder={AMOUNT_PLACEHOLDER}
          className="h-9 w-28 text-right tabular-nums"
          aria-label={
            mode === "percent" ? "Extra discount percent" : "Extra discount amount"
          }
          title={
            mode === "percent"
              ? "Percent of bill after trade discount"
              : "Rupees"
          }
        />
        <span className="min-w-[5rem] text-right text-[var(--muted)]">
          {formatPkr(amount)}
        </span>
      </div>
    </div>
  );
}

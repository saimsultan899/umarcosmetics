"use client";

import { Input } from "@/components/ui/input";
import {
  cartonShortLabel,
  formatUom,
  fromPieces,
  hasCartonPacking,
  perCartonRate,
  pieceShortLabel,
  piecesPerCarton,
  toPieces,
  type QtyUnitMode,
} from "@/lib/pricing/uom";
import { cn, formatPkr } from "@/lib/utils";
import {
  forwardRef,
  useEffect,
  useId,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";

type QtyUnitControlProps = {
  packing: number;
  /** Always stored / emitted in base pieces. */
  qty: string;
  onQtyChange: (qtyPieces: string) => void;
  unitType?: string | null;
  baseUnit?: string | null;
  /** Optional rate in base (per-piece) — shows carton equivalent hint. */
  rate?: string;
  showRateHint?: boolean;
  disabled?: boolean;
  className?: string;
  qtyClassName?: string;
  onQtyKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  qtyInputRef?: Ref<HTMLInputElement>;
  defaultMode?: QtyUnitMode;
  /** Compact for sticky table cells. */
  compact?: boolean;
};

/**
 * Qty entry with PCS / CTN toggle.
 * Internally always works in pieces; carton mode converts display ↔ pieces.
 */
export const QtyUnitControl = forwardRef<HTMLInputElement, QtyUnitControlProps>(
  function QtyUnitControl(
    {
      packing,
      qty,
      onQtyChange,
      unitType,
      baseUnit,
      rate,
      showRateHint = false,
      disabled,
      className,
      qtyClassName,
      onQtyKeyDown,
      qtyInputRef,
      defaultMode,
      compact,
    },
    _ref,
  ) {
    const canCarton = hasCartonPacking(packing);
    const [mode, setMode] = useState<QtyUnitMode>(defaultMode || "piece");
    const groupId = useId();
    const ppc = piecesPerCarton(packing);

    useEffect(() => {
      if (!canCarton && mode === "carton") setMode("piece");
    }, [canCarton, mode]);

    const ctnLabel = cartonShortLabel(unitType);
    const pcsLabel = pieceShortLabel(baseUnit);
    const breakdown = fromPieces(qty, packing);

    // CTN mode is whole cartons only — no leftover unit field.
    const displayQty =
      mode === "carton" && canCarton
        ? breakdown.cartons > 0
          ? String(breakdown.cartons)
          : ""
        : qty;

    const packHint = canCarton
      ? `1 ${ctnLabel} = ${ppc} ${pcsLabel}`
      : pcsLabel;

    const breakdownTitle = canCarton
      ? `${formatUom(qty, packing, { unitType, baseUnit })} · ${packHint}`
      : pcsLabel;

    function setModeSafe(next: QtyUnitMode) {
      if (next === "carton" && !canCarton) return;
      if (next === "carton" && mode === "piece") {
        // Drop leftover units (e.g. default qty 1) so CTN only shows cartons.
        const { cartons } = fromPieces(qty, packing);
        onQtyChange(cartons > 0 ? String(cartons * ppc) : "");
      }
      setMode(next);
    }

    function onDisplayQtyChange(raw: string) {
      if (mode === "carton" && canCarton) {
        if (raw.trim() === "") {
          onQtyChange("");
          return;
        }
        const cartons = Math.max(0, Math.floor(Number(raw || 0)));
        onQtyChange(cartons > 0 ? String(toPieces(cartons, 0, packing)) : "");
        return;
      }
      onQtyChange(raw);
    }

    if (compact) {
      return (
        <div className={cn("min-w-0", className)} title={breakdownTitle}>
          <div className="flex items-center gap-1">
            {canCarton ? (
              <div
                className="inline-flex shrink-0 rounded-md border border-[var(--border)] p-0.5 text-[10px] font-semibold uppercase"
                role="group"
                aria-label="Quantity unit"
              >
                <button
                  type="button"
                  id={`${groupId}-pcs`}
                  disabled={disabled}
                  onClick={() => setModeSafe("piece")}
                  className={cn(
                    "rounded px-1 py-0.5",
                    mode === "piece"
                      ? "bg-[var(--brand)] text-white"
                      : "text-[var(--muted)] hover:text-[var(--ink)]",
                  )}
                >
                  {pcsLabel}
                </button>
                <button
                  type="button"
                  id={`${groupId}-ctn`}
                  disabled={disabled}
                  onClick={() => setModeSafe("carton")}
                  className={cn(
                    "rounded px-1 py-0.5",
                    mode === "carton"
                      ? "bg-[var(--brand)] text-white"
                      : "text-[var(--muted)] hover:text-[var(--ink)]",
                  )}
                >
                  {ctnLabel}
                </button>
              </div>
            ) : null}
            <Input
              ref={qtyInputRef}
              type="number"
              min="0"
              step="1"
              value={displayQty}
              disabled={disabled}
              onChange={(e) => onDisplayQtyChange(e.target.value)}
              onKeyDown={onQtyKeyDown}
              className={cn("h-8 w-16 px-1.5 text-sm", qtyClassName)}
              title={breakdownTitle}
              placeholder={mode === "carton" ? ctnLabel : pcsLabel}
              aria-label={
                mode === "carton"
                  ? `Quantity (${ctnLabel})`
                  : `Quantity (${pcsLabel})`
              }
            />
          </div>
          {canCarton ? (
            <p className="mt-0.5 text-[10px] leading-tight text-[var(--muted)]">
              {packHint}
            </p>
          ) : null}
        </div>
      );
    }

    return (
      <div className={cn("space-y-1", className)}>
        {canCarton ? (
          <div
            className="inline-flex rounded-md border border-[var(--border)] p-0.5 text-[10px] font-semibold uppercase"
            role="group"
            aria-label="Quantity unit"
          >
            <button
              type="button"
              id={`${groupId}-pcs`}
              disabled={disabled}
              onClick={() => setModeSafe("piece")}
              className={cn(
                "rounded px-1.5 py-0.5",
                mode === "piece"
                  ? "bg-[var(--brand)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--ink)]",
              )}
            >
              {pcsLabel}
            </button>
            <button
              type="button"
              id={`${groupId}-ctn`}
              disabled={disabled}
              onClick={() => setModeSafe("carton")}
              className={cn(
                "rounded px-1.5 py-0.5",
                mode === "carton"
                  ? "bg-[var(--brand)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--ink)]",
              )}
            >
              {ctnLabel}
            </button>
          </div>
        ) : null}

        <div className="flex items-center gap-1">
          <Input
            ref={qtyInputRef}
            type="number"
            min="0"
            step="1"
            value={displayQty}
            disabled={disabled}
            onChange={(e) => onDisplayQtyChange(e.target.value)}
            onKeyDown={onQtyKeyDown}
            className={qtyClassName}
            placeholder={mode === "carton" ? ctnLabel : pcsLabel}
            title={
              mode === "carton"
                ? `${ctnLabel} — ${packHint}`
                : pcsLabel
            }
            aria-label={
              mode === "carton"
                ? `Quantity (${ctnLabel})`
                : `Quantity (${pcsLabel})`
            }
          />
        </div>

        {canCarton ? (
          <p className="text-[10px] text-[var(--muted)]">
            {packHint}
            {Number(qty) > 0
              ? ` · ${formatUom(qty, packing, { unitType, baseUnit })}`
              : ""}
          </p>
        ) : null}

        {showRateHint && rate != null && canCarton ? (
          <p className="text-[10px] text-[var(--muted)]">
            {formatPkr(perCartonRate(rate, packing))}/{ctnLabel.toLowerCase()}
          </p>
        ) : null}
      </div>
    );
  },
);

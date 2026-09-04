"use client";

import { Input } from "@/components/ui/input";
import {
  cartonShortLabel,
  formatUom,
  fromPieces,
  hasCartonPacking,
  perCartonRate,
  pieceShortLabel,
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
    const [mode, setMode] = useState<QtyUnitMode>(
      defaultMode || (canCarton ? "carton" : "piece"),
    );
    const groupId = useId();

    useEffect(() => {
      if (!canCarton && mode === "carton") setMode("piece");
    }, [canCarton, mode]);

    const ctnLabel = cartonShortLabel(unitType);
    const pcsLabel = pieceShortLabel(baseUnit);
    const breakdown = fromPieces(qty, packing);

    // Always derive CTN / loose from stored pieces so fields stay in sync
    // when lines are added/remounted (no stale local loose state).
    const displayQty =
      mode === "carton" && canCarton ? String(breakdown.cartons) : qty;
    const looseQty = String(breakdown.pieces || 0);

    function setModeSafe(next: QtyUnitMode) {
      if (next === "carton" && !canCarton) return;
      setMode(next);
    }

    function onDisplayQtyChange(raw: string) {
      if (mode === "carton" && canCarton) {
        const cartons = Math.max(0, Math.floor(Number(raw || 0)));
        onQtyChange(String(toPieces(cartons, breakdown.pieces, packing)));
        return;
      }
      onQtyChange(raw);
    }

    function onLooseChange(raw: string) {
      const loosePcs = Math.max(0, Number(raw || 0));
      onQtyChange(String(toPieces(breakdown.cartons, loosePcs, packing)));
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

        <div
          className={cn(
            "flex items-center gap-1",
            compact && "flex-col items-stretch",
          )}
        >
          <Input
            ref={qtyInputRef}
            type="number"
            min="0"
            step={mode === "carton" ? "1" : "0.1"}
            value={displayQty}
            disabled={disabled}
            onChange={(e) => onDisplayQtyChange(e.target.value)}
            onKeyDown={onQtyKeyDown}
            className={qtyClassName}
            title={
              mode === "carton"
                ? `${ctnLabel} — ${packing} ${pcsLabel}/${ctnLabel}`
                : pcsLabel
            }
            aria-label={
              mode === "carton"
                ? `Quantity (${ctnLabel})`
                : `Quantity (${pcsLabel})`
            }
          />
          {mode === "carton" && canCarton ? (
            <Input
              type="number"
              min="0"
              step="0.1"
              value={looseQty}
              disabled={disabled}
              onChange={(e) => onLooseChange(e.target.value)}
              className={cn(compact ? "h-7 text-[11px]" : "h-8 w-20 text-xs")}
              title={`Loose ${pcsLabel}`}
              aria-label={`Loose ${pcsLabel}`}
              placeholder={pcsLabel}
            />
          ) : null}
        </div>

        {canCarton ? (
          <p className="text-[10px] text-[var(--muted)]">
            {formatUom(qty, packing, { unitType, baseUnit })}
            {packing > 1 ? ` · ${packing}/${ctnLabel.toLowerCase()}` : ""}
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

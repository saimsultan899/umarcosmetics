"use client";

import { parseReportList } from "@/lib/reports/filter-params";
import { cn, fieldControlClass } from "@/lib/utils";
import { Check, ChevronsUpDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

type Option = { value: string; label: string };

export function FilterMultiSelect({
  name,
  label,
  value,
  options,
  allLabel = "All",
  placeholder,
}: {
  name: string;
  label: string;
  /** Comma-separated values from the URL. */
  value?: string;
  options: Option[];
  allLabel?: string;
  placeholder?: string;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const initial = useMemo(() => parseReportList(value), [value]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(initial);

  useEffect(() => {
    setSelected(parseReportList(value));
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const labelByValue = useMemo(
    () => new Map(options.map((o) => [o.value, o.label])),
    [options],
  );

  const triggerLabel = (() => {
    if (!selected.length) return allLabel;
    if (selected.length === 1) {
      return labelByValue.get(selected[0]) || "1 selected";
    }
    return `${selected.length} selected`;
  })();

  function toggle(value: string) {
    setSelected((current) =>
      current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value],
    );
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <label
        htmlFor={listId}
        className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]"
      >
        {label}
      </label>
      <button
        id={listId}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          fieldControlClass,
          "flex h-10 w-full items-center justify-between gap-2 px-3 text-left text-sm",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="min-w-0 truncate">{triggerLabel}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-[var(--muted)]" />
      </button>
      <input type="hidden" name={name} value={selected.join(",")} />

      {open ? (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-[var(--border)] bg-white py-1 shadow-lg"
        >
          {placeholder ? (
            <p className="border-b border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted)]">
              {placeholder}
            </p>
          ) : null}
          {options.length ? (
            options.map((option) => {
              const checked = selected.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => toggle(option.value)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-2)]",
                    checked && "bg-[var(--brand-soft)]/50",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      checked
                        ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                        : "border-[var(--border)] bg-white text-transparent",
                    )}
                  >
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  <span className="min-w-0 truncate">{option.label}</span>
                </button>
              );
            })
          ) : (
            <p className="px-3 py-2 text-sm text-[var(--muted)]">No options</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

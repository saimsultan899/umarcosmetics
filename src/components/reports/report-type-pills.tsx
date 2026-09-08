"use client";

import { parseReportList } from "@/lib/reports/filter-params";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type ReportTypeOption = { key: string; label: string };

export function ReportTypePills({
  options,
  paramName = "type",
  value,
  children,
}: {
  options: ReportTypeOption[];
  paramName?: string;
  /** Comma-separated keys from the URL. Selection stays local until Run report. */
  value?: string;
  /** Extra pills in the same row (e.g. Walk-in customer). */
  children?: React.ReactNode;
  /** @deprecated Kept so existing call sites type-check; selection no longer navigates. */
  preserveKeys?: string[];
}) {
  const fromUrl = useMemo(() => {
    const parsed = parseReportList(value);
    return parsed.length ? parsed : [options[0]?.key].filter(Boolean);
  }, [value, options]);

  const [selected, setSelected] = useState<string[]>(fromUrl);

  useEffect(() => {
    setSelected(fromUrl);
  }, [fromUrl]);

  function toggle(key: string) {
    setSelected((current) => {
      const active = current.length ? current : fromUrl;
      if (active.includes(key)) {
        return active.length === 1 ? active : active.filter((k) => k !== key);
      }
      return [...active, key];
    });
  }

  return (
    <div className="no-print flex flex-wrap gap-2">
      <input type="hidden" name={paramName} value={selected.join(",")} />
      {options.map((t) => {
        const checked = selected.includes(t.key);
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => toggle(t.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              checked
                ? "bg-[var(--brand)] text-white"
                : "border border-[var(--border)] bg-white text-[var(--muted)] hover:border-[var(--brand)]/40 hover:text-[var(--ink)]",
            )}
          >
            <span
              className={cn(
                "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                checked
                  ? "border-white/80 bg-white/20 text-white"
                  : "border-[var(--border)] bg-white text-transparent",
              )}
            >
              <Check className="h-2.5 w-2.5" strokeWidth={3} />
            </span>
            {t.label}
          </button>
        );
      })}
      {children}
    </div>
  );
}

/** Independent on/off pill in the report-type row (does not replace report types). */
export function FilterFlagPill({
  name,
  label,
  value,
}: {
  name: string;
  label: string;
  value?: string;
}) {
  const on = value === "1" || value === "true";
  const [checked, setChecked] = useState(on);
  const rootRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setChecked(on);
  }, [on]);

  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) return;
    function onClear() {
      setChecked(false);
    }
    form.addEventListener("report-filters-clear", onClear);
    return () => form.removeEventListener("report-filters-clear", onClear);
  }, []);

  return (
    <>
      <span
        className="mx-0.5 hidden h-6 w-px self-center bg-[var(--border)] sm:block"
        aria-hidden
      />
      <input type="hidden" name={name} value={checked ? "1" : ""} />
      <button
        ref={rootRef}
        type="button"
        onClick={() => setChecked((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
          checked
            ? "bg-[var(--brand)] text-white"
            : "border border-[var(--border)] bg-white text-[var(--muted)] hover:border-[var(--brand)]/40 hover:text-[var(--ink)]",
        )}
      >
        <span
          className={cn(
            "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
            checked
              ? "border-white/80 bg-white/20 text-white"
              : "border-[var(--border)] bg-white text-transparent",
          )}
        >
          <Check className="h-2.5 w-2.5" strokeWidth={3} />
        </span>
        {label}
      </button>
    </>
  );
}

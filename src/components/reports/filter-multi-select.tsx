"use client";

import { parseReportList } from "@/lib/reports/filter-params";
import { cn, fieldControlClass } from "@/lib/utils";
import { Check, ChevronsUpDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  const triggerId = `${listId}-trigger`;
  const menuId = `${listId}-menu`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const initial = useMemo(() => parseReportList(value), [value]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(initial);
  const [mounted, setMounted] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setSelected(parseReportList(value));
  }, [value]);

  useEffect(() => {
    if (!open) return;

    function position() {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < 260 && rect.top > spaceBelow;
      setMenuStyle({
        position: "fixed",
        left: rect.left,
        width: Math.max(rect.width, 220),
        zIndex: 120,
        ...(openUp
          ? { bottom: window.innerHeight - rect.top + 6 }
          : { top: rect.bottom + 6 }),
      });
    }

    position();

    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onReposition() {
      position();
    }

    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, listId]);

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
        htmlFor={triggerId}
        className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]"
      >
        {label}
      </label>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          fieldControlClass,
          "flex h-10 w-full items-center justify-between gap-2 px-3 text-left text-sm",
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        <span className="min-w-0 truncate">{triggerLabel}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-[var(--muted)]" />
      </button>
      <input type="hidden" name={name} value={selected.join(",")} />

      {open && mounted
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="listbox"
              aria-multiselectable="true"
              style={menuStyle}
              className="max-h-60 overflow-y-auto rounded-lg border border-[var(--border)] bg-white py-1 shadow-[0_18px_50px_rgba(11,25,21,0.18)] ring-1 ring-black/5"
              onMouseDown={(e) => e.preventDefault()}
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
                      onClick={(e) => {
                        e.preventDefault();
                        toggle(option.value);
                      }}
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
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

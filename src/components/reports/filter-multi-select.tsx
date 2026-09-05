"use client";

import { parseReportList } from "@/lib/reports/filter-params";
import { getFloatingMenuStyle } from "@/lib/ui/floating-menu";
import { cn, fieldControlClass } from "@/lib/utils";
import { Check, ChevronsUpDown, Search } from "lucide-react";
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
  searchable = true,
  searchPlaceholder,
}: {
  name: string;
  label: string;
  /** Comma-separated values from the URL. */
  value?: string;
  options: Option[];
  allLabel?: string;
  placeholder?: string;
  /** Show type-to-filter search inside the dropdown (default true). */
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const listId = useId();
  const triggerId = `${listId}-trigger`;
  const menuId = `${listId}-menu`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const initial = useMemo(() => parseReportList(value), [value]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(initial);
  const [mounted, setMounted] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [query, setQuery] = useState("");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setSelected(parseReportList(value));
  }, [value]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    function position() {
      const el = triggerRef.current;
      if (!el) return;
      setMenuStyle(
        getFloatingMenuStyle(el.getBoundingClientRect(), {
          minWidth: 260,
          preferredMaxHeight: 288,
          zIndex: 220,
        }),
      );
    }

    position();
    const focusTimer = window.setTimeout(() => {
      if (searchable) searchRef.current?.focus();
    }, 0);

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
      window.clearTimeout(focusTimer);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, listId, searchable]);

  const labelByValue = useMemo(
    () => new Map(options.map((o) => [o.value, o.label])),
    [options],
  );

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  const triggerLabel = (() => {
    if (!selected.length) return allLabel;
    if (selected.length === 1) {
      return labelByValue.get(selected[0]) || "1 selected";
    }
    return `${selected.length} selected`;
  })();

  function toggle(optionValue: string) {
    setSelected((current) =>
      current.includes(optionValue)
        ? current.filter((v) => v !== optionValue)
        : [...current, optionValue],
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
              className="flex flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-[0_18px_50px_rgba(11,25,21,0.18)] ring-1 ring-black/5"
            >
              {searchable ? (
                <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-2.5 py-2">
                  <Search className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setOpen(false);
                      }
                    }}
                    placeholder={
                      searchPlaceholder || `Search ${label.toLowerCase()}...`
                    }
                    className="!h-7 min-w-0 w-full !border-0 !bg-transparent px-0 text-sm outline-none !shadow-none placeholder:text-[var(--muted)] focus:!border-0 focus:!shadow-none"
                    aria-label={`Search ${label}`}
                  />
                </div>
              ) : placeholder ? (
                <p className="shrink-0 border-b border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted)]">
                  {placeholder}
                </p>
              ) : null}

              <div className="min-h-0 flex-1 overflow-y-auto py-1">
                {filteredOptions.length ? (
                  filteredOptions.map((option) => {
                    const checked = selected.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={checked}
                        onMouseDown={(e) => e.preventDefault()}
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
                  <p className="px-3 py-3 text-sm text-[var(--muted)]">
                    {query.trim() ? "No matches" : "No options"}
                  </p>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

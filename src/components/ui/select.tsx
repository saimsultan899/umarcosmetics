"use client";

import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SelectChangeEvent = {
  target: { value: string; name?: string };
};

const DEFAULT_VISIBLE = 6;

function extractOptions(children: ReactNode): SelectOption[] {
  const opts: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) {
      return;
    }
    if (child.type !== "option") return;
    const label =
      typeof child.props.children === "string" ||
      typeof child.props.children === "number"
        ? String(child.props.children)
        : Children.toArray(child.props.children).join("");
    opts.push({
      value: String(child.props.value ?? ""),
      label: label.trim() || String(child.props.value ?? ""),
      disabled: Boolean(child.props.disabled),
    });
  });
  return opts;
}

function matches(option: SelectOption, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    option.label.toLowerCase().includes(q) ||
    option.value.toLowerCase().includes(q)
  );
}

export function Select({
  value,
  defaultValue = "",
  onChange,
  name,
  required,
  disabled,
  className,
  placeholder,
  options: optionsProp,
  children,
  maxVisible = DEFAULT_VISIBLE,
  size = "md",
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (e: SelectChangeEvent) => void;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  options?: SelectOption[];
  children?: ReactNode;
  maxVisible?: number;
  size?: "sm" | "md";
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const selectedValue = value !== undefined ? value : uncontrolled;
  const options = useMemo(
    () => optionsProp ?? extractOptions(children),
    [optionsProp, children],
  );

  const emptyOption = options.find((o) => o.value === "");
  const choosable = useMemo(
    () => options.filter((o) => o.value !== ""),
    [options],
  );

  const selected = options.find((o) => o.value === selectedValue) || null;
  const displayLabel =
    selected?.label ||
    placeholder ||
    emptyOption?.label ||
    "Select...";

  const filtered = useMemo(() => {
    const list = choosable.filter((o) => matches(o, query));
    if (
      selectedValue &&
      !query.trim() &&
      !list.slice(0, maxVisible).some((o) => o.value === selectedValue)
    ) {
      const current = choosable.find((o) => o.value === selectedValue);
      if (current) {
        return [
          current,
          ...list.filter((o) => o.value !== selectedValue),
        ];
      }
    }
    return list;
  }, [choosable, query, selectedValue, maxVisible]);

  const visible = filtered.slice(0, maxVisible);
  const hiddenCount = Math.max(0, filtered.length - visible.length);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;

    function position() {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < 280 && rect.top > spaceBelow;
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      const menu = document.getElementById(listId);
      if (menu?.contains(target)) return;
      setOpen(false);
    };

    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    requestAnimationFrame(() => inputRef.current?.focus());

    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open, listId]);

  function commit(next: string) {
    if (value === undefined) setUncontrolled(next);
    onChange?.({ target: { value: next, name } });
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} className={cn("relative w-full", className)}>
      {name || required ? (
        <input
          tabIndex={-1}
          aria-hidden
          name={name}
          value={selectedValue}
          required={required}
          onChange={() => undefined}
          className="pointer-events-none absolute h-px w-px opacity-0"
        />
      ) : null}
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-required={required}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
          setQuery("");
        }}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-white text-left text-[var(--ink)] outline-none transition",
          "focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-soft)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          size === "sm" ? "h-9 px-2 text-sm" : "h-10 px-3 text-sm",
          !selectedValue && "text-[var(--muted)]",
        )}
      >
        <span className="truncate">{displayLabel}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-[var(--muted)]" />
      </button>

      {open && mounted
        ? createPortal(
            <div
              id={listId}
              role="listbox"
              style={menuStyle}
              className="overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-[0_18px_50px_rgba(11,25,21,0.18)] ring-1 ring-black/5"
            >
              <div className="border-b border-[var(--border)] p-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search..."
                    className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] py-2 pl-8 pr-3 text-sm outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-soft)]"
                  />
                </div>
              </div>

              <div className="max-h-64 overflow-y-auto p-1">
                {emptyOption ? (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedValue === ""}
                    onClick={() => commit("")}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm",
                      selectedValue === ""
                        ? "bg-[var(--brand-soft)] text-[var(--brand-strong)]"
                        : "text-[var(--muted)] hover:bg-[var(--surface-2)]",
                    )}
                  >
                    <span className="truncate">{emptyOption.label}</span>
                    {selectedValue === "" ? (
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    ) : null}
                  </button>
                ) : null}

                {visible.length ? (
                  visible.map((option) => {
                    const active = option.value === selectedValue;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={active}
                        disabled={option.disabled}
                        onClick={() => commit(option.value)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm",
                          active
                            ? "bg-[var(--brand)] text-white"
                            : "text-[var(--ink)] hover:bg-[var(--surface-2)]",
                          option.disabled && "opacity-50",
                        )}
                      >
                        <span className="truncate">{option.label}</span>
                        {active ? (
                          <Check className="h-3.5 w-3.5 shrink-0" />
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <p className="px-3 py-3 text-sm text-[var(--muted)]">
                    No matches. Try another search.
                  </p>
                )}
              </div>

              {hiddenCount > 0 ? (
                <p className="border-t border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted)]">
                  Showing {visible.length} of {filtered.length}. Type to narrow
                  results.
                </p>
              ) : choosable.length > maxVisible && !query.trim() ? (
                <p className="border-t border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted)]">
                  Showing top {maxVisible}. Search to find more.
                </p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FilterMultiSelect } from "@/components/reports/filter-multi-select";
import { ReportTypePills } from "@/components/reports/report-type-pills";
import { UrlFilterForm } from "@/components/reports/url-filter-form";
import { cn } from "@/lib/utils";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

type Option = { value: string; label: string };

export { FilterMultiSelect };

/** Params that stay when the user clicks Clear filter (report type + dates). */
const KEEP_FILTER_KEYS = ["type", "from", "to", "preset", "view"];

export function ReportFilterActions({
  submitLabel = "Run report",
  keepKeys = KEEP_FILTER_KEYS,
  className,
}: {
  submitLabel?: string;
  keepKeys?: string[];
  className?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onClear(e: React.MouseEvent<HTMLButtonElement>) {
    const form = e.currentTarget.form;
    if (!form) return;

    form.dispatchEvent(
      new CustomEvent("report-filters-clear", {
        bubbles: true,
        detail: { keep: keepKeys },
      }),
    );

    const keep = new Set(keepKeys);
    for (const el of Array.from(form.elements)) {
      if (
        !(
          el instanceof HTMLInputElement ||
          el instanceof HTMLSelectElement ||
          el instanceof HTMLTextAreaElement
        )
      ) {
        continue;
      }
      if (!el.name || keep.has(el.name)) continue;
      if (el instanceof HTMLInputElement && el.type === "hidden") continue;
      if (el instanceof HTMLInputElement && (el.type === "date" || el.type === "text" || el.type === "search")) {
        if (el.type === "date") continue;
        el.value = "";
      } else if (el instanceof HTMLSelectElement) {
        el.value = "";
      } else if (el instanceof HTMLTextAreaElement) {
        el.value = "";
      }
    }

    const params = new URLSearchParams();
    for (const key of keepKeys) {
      const named = form.elements.namedItem(key);
      if (!named) continue;
      const raw =
        named instanceof RadioNodeList
          ? String(named.value || "")
          : named instanceof HTMLInputElement ||
              named instanceof HTMLSelectElement
            ? String(named.value || "")
            : "";
      const v = raw.trim();
      if (v) params.set(key, v);
    }

    const action = form.getAttribute("action");
    const base = action && action !== "#" ? action : pathname;
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${base}?${qs}` : base, { scroll: false });
    });
  }

  return (
    <div
      className={cn(
        "flex items-end gap-2 sm:col-span-2 lg:col-span-2",
        className,
      )}
    >
      <button
        type="submit"
        disabled={isPending}
        className="h-10 min-w-0 flex-1 rounded-lg bg-[var(--brand)] px-4 text-sm font-medium text-white disabled:opacity-70"
      >
        {submitLabel}
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={isPending}
        className="h-10 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-white px-4 text-sm font-medium text-[var(--ink)] hover:border-[var(--brand)]/40 disabled:opacity-70"
      >
        Clear filter
      </button>
    </div>
  );
}

export function ReportFilters({
  action,
  defaults,
  extras,
  typeOptions,
  typeExtras,
}: {
  action: string;
  defaults: {
    from?: string;
    to?: string;
    type?: string;
    warehouse?: string;
    party?: string;
    billFrom?: string;
    billTo?: string;
    walkin?: string;
  };
  extras?: React.ReactNode;
  typeOptions?: { key: string; label: string }[];
  typeExtras?: React.ReactNode;
}) {
  return (
    <UrlFilterForm
      action={action}
      className="panel no-print grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {typeOptions?.length ? (
        <div className="sm:col-span-2 lg:col-span-4">
          <p className="mb-1.5 text-xs font-semibold uppercase text-[var(--muted)]">
            Report type
          </p>
          <ReportTypePills options={typeOptions} value={defaults.type}>
            {typeExtras}
          </ReportTypePills>
        </div>
      ) : defaults.type !== undefined ? (
        <input type="hidden" name="type" value={defaults.type} />
      ) : null}
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
          From date
        </label>
        <Input type="date" name="from" defaultValue={defaults.from} />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
          To date
        </label>
        <Input type="date" name="to" defaultValue={defaults.to} />
      </div>
      {extras}
      <ReportFilterActions />
    </UrlFilterForm>
  );
}

export function FilterSelect({
  name,
  label,
  value,
  options,
  allLabel = "All",
}: {
  name: string;
  label: string;
  value?: string;
  options: Option[];
  allLabel?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
        {label}
      </label>
      <Select
        name={name}
        defaultValue={value || ""}
        options={[
          { value: "", label: allLabel },
          ...options,
        ]}
      />
    </div>
  );
}

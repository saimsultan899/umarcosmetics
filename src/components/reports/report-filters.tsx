"use client";

import { Select } from "@/components/ui/select";

type Option = { value: string; label: string };

export function ReportFilters({
  action,
  defaults,
  extras,
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
  };
  extras?: React.ReactNode;
}) {
  return (
    <form
      action={action}
      method="get"
      className="panel no-print grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
          From date
        </label>
        <input
          type="date"
          name="from"
          defaultValue={defaults.from}
          className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
          To date
        </label>
        <input
          type="date"
          name="to"
          defaultValue={defaults.to}
          className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
        />
      </div>
      {defaults.type !== undefined ? (
        <input type="hidden" name="type" value={defaults.type} />
      ) : null}
      {extras}
      <div className="flex items-end sm:col-span-2 lg:col-span-1">
        <button
          type="submit"
          className="h-10 w-full rounded-lg bg-[var(--brand)] px-4 text-sm font-medium text-white"
        >
          Run report
        </button>
      </div>
    </form>
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

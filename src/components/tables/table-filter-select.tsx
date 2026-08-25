"use client";

type Option = { value: string; label: string };

export function TableFilterSelect({
  label,
  value,
  options,
  onChange,
  allLabel = "All",
  loading = false,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string | null) => void;
  allLabel?: string;
  loading?: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={loading}
        className="h-8 max-w-[180px] truncate rounded-lg border border-[var(--border)] bg-white px-2 text-sm disabled:opacity-60"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function warehouseOptions(
  warehouses: Array<{ id: string; name: string }>,
) {
  return warehouses.map((w) => ({ value: w.id, label: w.name }));
}

export function stringOptions(values: string[]) {
  return values.map((v) => ({ value: v, label: v }));
}

"use client";

import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { SalesmanOption } from "@/lib/queries/salesmen";

export function SalesmanSelect({
  salesmen,
  value,
  onChange,
  required,
  label = "Salesman",
  hint,
}: {
  salesmen: SalesmanOption[];
  value: string;
  onChange: (userId: string) => void;
  required?: boolean;
  label?: string;
  hint?: string;
}) {
  if (!salesmen.length) {
    return (
      <div>
        <Label>{label}</Label>
        <p className="mt-1 text-xs text-[var(--muted)]">
          No salesmen yet — add them from Salesman → Users &amp; Sectors.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Label>{label}</Label>
      <Select
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{required ? "Select salesman" : "Unassigned"}</option>
        {salesmen.map((s) => (
          <option key={s.user_id} value={s.user_id}>
            {s.full_name || s.user_id.slice(0, 8)}
          </option>
        ))}
      </Select>
      {hint ? (
        <p className="mt-1 text-[11px] text-[var(--muted)]">{hint}</p>
      ) : (
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          Optional — used for salesman-wise performance &amp; recovery history.
        </p>
      )}
    </div>
  );
}

"use client";

import { Input } from "@/components/ui/input";
import { UrlFilterForm } from "@/components/reports/url-filter-form";
import { PROFIT_PRESETS, type ProfitPreset } from "@/lib/reports/profit-periods";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function ProfitPeriodFilters({
  preset,
  from,
  to,
}: {
  preset: ProfitPreset;
  from: string;
  to: string;
}) {
  const pathname = usePathname();

  return (
    <div className="no-print space-y-3">
      <div className="flex flex-wrap gap-2">
        {PROFIT_PRESETS.map((p) => {
          const active = preset === p.id;
          const href =
            p.id === "custom"
              ? `${pathname}?preset=custom&from=${from}&to=${to}`
              : `${pathname}?preset=${p.id}`;
          return (
            <Link
              key={p.id}
              href={href}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                active
                  ? "bg-[var(--brand)] text-white"
                  : "border border-[var(--border)] bg-white text-[var(--muted)] hover:border-[var(--brand)] hover:text-[var(--ink)]",
              )}
            >
              {p.label}
            </Link>
          );
        })}
      </div>

      {preset === "custom" ? (
        <UrlFilterForm
          action={pathname}
          className="panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <input type="hidden" name="preset" value="custom" />
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
              From date
            </label>
            <Input type="date" name="from" defaultValue={from} required />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
              To date
            </label>
            <Input type="date" name="to" defaultValue={to} required />
          </div>
          <div className="flex items-end sm:col-span-2 lg:col-span-1">
            <button
              type="submit"
              className="h-10 w-full rounded-lg bg-[var(--brand)] px-4 text-sm font-medium text-white"
            >
              Run report
            </button>
          </div>
        </UrlFilterForm>
      ) : (
        <p className="text-sm text-[var(--muted)]">
          Period: <span className="font-medium text-[var(--ink)]">{from}</span> to{" "}
          <span className="font-medium text-[var(--ink)]">{to}</span>
        </p>
      )}
    </div>
  );
}

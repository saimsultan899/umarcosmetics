import { cn, formatNumber, formatPkr } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

export type StatTone = "brand" | "ok" | "warn" | "danger" | "neutral";

const toneClass: Record<StatTone, string> = {
  brand: "text-[var(--brand)] bg-[var(--brand-soft)]",
  ok: "text-emerald-700 bg-emerald-50",
  warn: "text-amber-700 bg-amber-50",
  danger: "text-rose-700 bg-rose-50",
  neutral: "text-[var(--muted)] bg-[var(--surface-2)]",
};

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  tone = "brand",
  format = "text",
  className,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon?: LucideIcon;
  href?: string;
  tone?: StatTone;
  format?: "text" | "money" | "number";
  className?: string;
}) {
  const display =
    format === "money"
      ? formatPkr(Number(value || 0))
      : format === "number"
        ? formatNumber(Number(value || 0), 0)
        : String(value);

  const body = (
    <div
      className={cn(
        "stat-tile h-full transition",
        href ? "hover:border-[var(--brand)]" : null,
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          {label}
        </p>
        {Icon ? (
          <span
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-xl",
              toneClass[tone],
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
      </div>
      <p className="mt-3 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">
        {display}
      </p>
      {hint ? (
        <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">{hint}</p>
      ) : null}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {body}
      </Link>
    );
  }
  return body;
}

export function StatsGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 sm:grid-cols-2 xl:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

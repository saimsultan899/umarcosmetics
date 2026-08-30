import { cn, formatNumber, formatPkr, amountClass } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { type ReactNode } from "react";

export type StatTone = "brand" | "ok" | "warn" | "danger" | "neutral";

export type StatCardColor =
  | "sky"
  | "mint"
  | "blue"
  | "purple"
  | "green"
  | "lavender"
  | "peach";

const toneClass: Record<StatTone, string> = {
  brand: "text-[var(--stat-icon)]",
  ok: "text-emerald-600",
  warn: "text-[var(--stat-icon)]",
  danger: "text-rose-600",
  neutral: "text-[var(--muted)]",
};

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  tone = "brand",
  color: _color,
  format = "text",
  className,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon?: LucideIcon;
  href?: string;
  tone?: StatTone;
  color?: StatCardColor;
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
        "stat-tile h-full",
        href ? "cursor-pointer" : null,
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="stat-tile__label">{label}</p>
        {Icon ? (
          <span className="stat-tile__icon">
            <Icon className={cn("h-3.5 w-3.5", toneClass[tone])} />
          </span>
        ) : null}
      </div>
      <p
        className={cn(
          "stat-tile__value",
          format !== "text" ? amountClass : null,
        )}
      >
        {display}
      </p>
      {hint ? <p className="stat-tile__hint">{hint}</p> : null}
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

StatCard.displayName = "StatCard";

export function StatsGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

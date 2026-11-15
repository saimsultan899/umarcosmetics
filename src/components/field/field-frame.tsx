import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export function FieldHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--brand)]">
          Salesman
        </p>
        <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function FieldLinkButton({
  href,
  children,
  tone = "ghost",
}: {
  href: string;
  children: ReactNode;
  tone?: "solid" | "ghost";
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-10 items-center rounded-[var(--radius-sm)] px-3.5 text-sm font-semibold",
        tone === "solid"
          ? "bg-[var(--brand)] text-white"
          : "border border-[var(--border)] bg-white text-[var(--ink)]",
      )}
    >
      {children}
    </Link>
  );
}

export function FieldTile({
  href,
  label,
  hint,
  icon: Icon,
  tone,
}: {
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  tone: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-white px-4 py-3.5 transition hover:border-[var(--brand)]"
    >
      <span
        className={cn(
          "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius)]",
          tone,
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[var(--ink)]">{label}</span>
        <span className="block text-xs leading-5 text-[var(--muted)]">{hint}</span>
      </span>
    </Link>
  );
}

"use client";

import { cn } from "@/lib/utils";

export function FilterChip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-semibold transition",
          active
          ? "bg-[var(--brand)] text-white"
          : "border border-[var(--border)] bg-white text-[var(--muted)] hover:border-[var(--brand)] hover:text-[var(--ink)]",
      )}
    >
      {children}
    </button>
  );
}

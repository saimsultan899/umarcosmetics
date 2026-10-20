"use client";

import { Select } from "@/components/ui/select";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/** Sector dropdown for accounts balances / ledger — keeps other URL params. */
export function AccountsSectorFilter({
  options,
  className,
  label = "Sector",
  keepKeys = ["view", "party"],
  /** Hide label so the control sits flush with a search input on one row. */
  compact = false,
  /** When true, changing sector clears `party` from the URL. */
  clearPartyOnChange = false,
}: {
  options: string[];
  className?: string;
  label?: string;
  keepKeys?: string[];
  compact?: boolean;
  clearPartyOnChange?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const value = (searchParams.get("sector") || "").trim();

  function onChange(next: string) {
    const params = new URLSearchParams();
    for (const key of keepKeys) {
      if (clearPartyOnChange && key === "party") continue;
      const v = (searchParams.get(key) || "").trim();
      if (v) params.set(key, v);
    }
    const sector = next.trim();
    if (sector) params.set("sector", sector);
    if (clearPartyOnChange && sector !== value) {
      // Party cleared above via skip; ensure it stays cleared when sector changes.
      params.delete("party");
    }
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    <div className={className || "w-[11.5rem] shrink-0"}>
      {compact ? (
        <span className="sr-only">{label}</span>
      ) : (
        <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
          {label}
        </label>
      )}
      <Select
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        options={[
          { value: "", label: "All sectors" },
          ...options.map((s) => ({ value: s, label: s })),
        ]}
      />
    </div>
  );
}

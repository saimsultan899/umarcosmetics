"use client";

import { parseReportList, reportLinkQuery } from "@/lib/reports/filter-params";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

type ReportTypeOption = { key: string; label: string };

export function ReportTypePills({
  options,
  paramName = "type",
  preserveKeys = ["from", "to", "warehouse", "party", "billFrom", "billTo"],
}: {
  options: ReportTypeOption[];
  paramName?: string;
  preserveKeys?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const selected = parseReportList(searchParams.get(paramName) || undefined);
  const activeKeys = selected.length ? selected : [options[0]?.key].filter(Boolean);

  function toggle(key: string) {
    const current = parseReportList(searchParams.get(paramName) || undefined);
    const active = current.length ? current : [options[0]?.key].filter(Boolean);

    const next = active.includes(key)
      ? active.length === 1
        ? active
        : active.filter((k) => k !== key)
      : [...active, key];

    const preserve: Record<string, string | undefined> = {};
    for (const k of preserveKeys) {
      const v = searchParams.get(k);
      if (v) preserve[k] = v;
    }

    const params = reportLinkQuery(
      preserve,
      next.length ? { [paramName]: next.join(",") } : {},
    );

    startTransition(() => {
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    <div
      className={cn(
        "no-print flex flex-wrap gap-2",
        isPending && "pointer-events-none opacity-60",
      )}
    >
      {options.map((t) => {
        const checked = activeKeys.includes(t.key);
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => toggle(t.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              checked
                ? "bg-[var(--brand)] text-white"
                : "border border-[var(--border)] bg-white text-[var(--muted)] hover:border-[var(--brand)]/40 hover:text-[var(--ink)]",
            )}
          >
            <span
              className={cn(
                "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                checked
                  ? "border-white/80 bg-white/20 text-white"
                  : "border-[var(--border)] bg-white text-transparent",
              )}
            >
              <Check className="h-2.5 w-2.5" strokeWidth={3} />
            </span>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

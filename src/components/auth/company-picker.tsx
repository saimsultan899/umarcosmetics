"use client";

import type { Company, CompanyMember } from "@/lib/types/database";
import { Building2, CheckCircle2 } from "lucide-react";

export type CompanyMembership = CompanyMember & { companies: Company };

export function CompanyPicker({
  rows,
  picking,
  preferredId,
  onPick,
}: {
  rows: CompanyMembership[];
  picking?: string | null;
  preferredId?: string | null;
  onPick: (companyId: string) => void;
}) {
  const ordered = [...rows].sort((a, b) => {
    if (preferredId && a.companies?.id === preferredId) return -1;
    if (preferredId && b.companies?.id === preferredId) return 1;
    return (a.companies?.name || "").localeCompare(b.companies?.name || "");
  });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {ordered.map((row) => {
        const c = row.companies;
        if (!c) return null;
        const preferred = preferredId === c.id;
        const busy = picking === c.id;
        return (
          <button
            key={row.id}
            type="button"
            onClick={() => onPick(c.id)}
            disabled={busy}
            className={`panel group p-5 text-left transition hover:-translate-y-0.5 hover:border-[var(--brand)] disabled:opacity-60 ${
              preferred ? "border-[var(--brand)] ring-2 ring-[var(--brand-soft)]" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
                <Building2 className="h-5 w-5" />
              </div>
              <CheckCircle2 className="h-5 w-5 text-[var(--brand)] opacity-0 transition group-hover:opacity-100" />
            </div>
            <h2 className="mt-4 font-[family-name:var(--font-display)] text-xl font-semibold">
              {c.name}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {[c.city, c.address].filter(Boolean).join(" · ") ||
                "Company workspace"}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)]">
                Role: {row.role.replaceAll("_", " ")}
              </p>
              {preferred ? (
                <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--brand)]">
                  Last used
                </span>
              ) : null}
            </div>
            <div className="mt-4">
              <span className="inline-flex h-8 items-center rounded-lg bg-[var(--brand)] px-3 text-xs font-medium text-white shadow-sm group-hover:bg-[var(--brand-strong)]">
                {busy ? "Opening..." : "Open dashboard"}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

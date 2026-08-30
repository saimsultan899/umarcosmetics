"use client";

import type { Company, CompanyMember } from "@/lib/types/database";
import { Building2, CheckCircle2, Loader2 } from "lucide-react";

export type CompanyMembership = CompanyMember & { companies: Company };

function LoginCompanyTile({
  row,
  preferred,
  busy,
  onPick,
}: {
  row: CompanyMembership;
  preferred: boolean;
  busy: boolean;
  onPick: () => void;
}) {
  const c = row.companies;
  if (!c) return null;

  const location =
    [c.city, c.address].filter(Boolean).join(" · ") || "Workspace";

  return (
    <button
      type="button"
      onClick={onPick}
      disabled={busy}
      className={`login-company-card group ${preferred ? "login-company-card--preferred" : ""}`}
      title={`Open ${c.name}`}
    >
      <div className="login-company-card__head">
        <span className="login-company-card__icon">
          <Building2 className="h-3.5 w-3.5" />
        </span>
        {preferred ? (
          <CheckCircle2 className="login-company-card__check" />
        ) : (
          <CheckCircle2 className="login-company-card__check login-company-card__check--hover" />
        )}
      </div>
      <p className="login-company-card__name">{c.name}</p>
      <p className="login-company-card__meta">{location}</p>
      <div className="login-company-card__tags">
        <span className="login-company-card__tag">
          {row.role.replaceAll("_", " ")}
        </span>
        {preferred ? (
          <span className="login-company-card__tag login-company-card__tag--soft">
            Last
          </span>
        ) : null}
      </div>
      {busy ? (
        <span className="login-company-card__busy">
          <Loader2 className="h-3 w-3 animate-spin" />
          Opening
        </span>
      ) : null}
    </button>
  );
}

export function CompanyPicker({
  rows,
  picking,
  preferredId,
  onPick,
  variant = "default",
}: {
  rows: CompanyMembership[];
  picking?: string | null;
  preferredId?: string | null;
  onPick: (companyId: string) => void;
  variant?: "default" | "login";
}) {
  const ordered = [...rows].sort((a, b) => {
    if (preferredId && a.companies?.id === preferredId) return -1;
    if (preferredId && b.companies?.id === preferredId) return 1;
    return (a.companies?.name || "").localeCompare(b.companies?.name || "");
  });

  if (variant === "login") {
    const cols =
      ordered.length >= 4 ? 3 : ordered.length === 3 ? 3 : ordered.length;

    return (
      <div
        className="login-company-grid"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {ordered.map((row) => {
          const c = row.companies;
          if (!c) return null;
          return (
            <LoginCompanyTile
              key={row.id}
              row={row}
              preferred={preferredId === c.id}
              busy={picking === c.id}
              onPick={() => onPick(c.id)}
            />
          );
        })}
      </div>
    );
  }

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
              preferred ? "border-[var(--brand)] ring-1 ring-[var(--brand-soft)]" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
                <Building2 className="h-4 w-4" />
              </div>
              <CheckCircle2 className="h-5 w-5 text-[var(--brand)] opacity-0 transition group-hover:opacity-100" />
            </div>
            <h2 className="mt-3 font-[family-name:var(--font-display)] text-lg font-semibold">
              {c.name}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {[c.city, c.address].filter(Boolean).join(" · ") ||
                "Company workspace"}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--brand)]">
                {row.role.replaceAll("_", " ")}
              </span>
              {preferred ? (
                <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--brand)]">
                  Last used
                </span>
              ) : null}
            </div>
            <div className="mt-3">
              <span className="inline-flex h-8 items-center rounded-md bg-[var(--brand)] px-3 text-xs font-semibold text-white group-hover:bg-[var(--brand-strong)]">
                {busy ? "Opening..." : "Open dashboard"}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

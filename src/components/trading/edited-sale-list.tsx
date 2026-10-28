"use client";

import type { EditedSaleRef } from "@/lib/trading/edited-sales";
import { formatPkr } from "@/lib/utils";
import Link from "next/link";

function shortDate(iso: string) {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function EditedSaleList({ rows }: { rows: EditedSaleRef[] }) {
  if (!rows.length) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-[var(--border)] px-4 text-center text-sm text-[var(--muted)]">
        No edited bills yet. After you change an older bill, its number stays here.
      </div>
    );
  }

  const max = Math.max(...rows.map((row) => row.total), 1);

  return (
    <div className="space-y-3">
      {rows.map((row, index) => {
        const width = Math.max(8, (row.total / max) * 100);
        const detail = [row.code, row.name].filter(Boolean).join(" — ");
        const when = shortDate(row.date);
        return (
          <Link
            key={row.id}
            href={row.href}
            className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-2 rounded-lg outline-none hover:bg-[var(--surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            <span className="text-xs font-semibold tabular-nums text-[var(--muted)]">
              {index + 1}
            </span>
            <div className="min-w-0 py-0.5">
              <div className="mb-0.5 flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-medium text-[var(--ink)]">
                  {row.invoiceNo || "Sale invoice"}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-[var(--ink)]">
                  {formatPkr(row.total)}
                </span>
              </div>
              <p className="mb-1 truncate text-[11px] text-[var(--muted)]">
                {detail || "Shop"}
                {when ? ` · ${when}` : ""}
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                <div
                  className="h-full rounded-full bg-[var(--brand)]"
                  style={{ width: `${width}%`, opacity: index === 0 ? 1 : 0.72 }}
                />
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

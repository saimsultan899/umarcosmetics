"use client";

import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Horizontal scroll area for a table body plus a loading state. While
 * `loading` is true the current rows stay visible but blurred and a single
 * round spinner floats over them — so paging feels like the same table
 * refreshing in place, not the whole screen reloading.
 *
 * Renders a fragment (scroll div + overlay) so both stay direct children of
 * `.table-shell`, which the table CSS targets with `> .table-scroll`.
 */
export function TableScroll({
  loading = false,
  children,
}: {
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <div
        className={cn("table-scroll", loading && "table-scroll--loading")}
        aria-busy={loading}
      >
        {children}
      </div>
      {loading ? (
        <div className="table-loading no-print" role="status" aria-label="Loading">
          <span className="table-loading__spinner">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          </span>
        </div>
      ) : null}
    </>
  );
}

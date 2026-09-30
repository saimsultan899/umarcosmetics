"use client";

import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export function TableToolbar({
  query,
  onQueryChange,
  placeholder = "Search table...",
  filters,
  resultCount,
  totalCount,
  loading = false,
  onFocus,
  onBlur,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder?: string;
  filters?: React.ReactNode;
  resultCount: number;
  totalCount: number;
  loading?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="relative w-full shrink-0 sm:w-64">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder}
          className="pl-9"
          aria-busy={loading}
        />
      </div>
      {filters ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          {filters}
        </div>
      ) : null}
      <span className="ml-auto shrink-0 rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--muted)]">
        {resultCount === totalCount
          ? `${totalCount} total`
          : `${resultCount} of ${totalCount}`}
      </span>
    </div>
  );
}

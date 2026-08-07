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
}: {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder?: string;
  filters?: React.ReactNode;
  resultCount: number;
  totalCount: number;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div className="relative min-w-[220px] flex-1 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          className="pl-9"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {filters}
        <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--muted)]">
          {resultCount === totalCount
            ? `${totalCount} total`
            : `${resultCount} of ${totalCount}`}
        </span>
      </div>
    </div>
  );
}

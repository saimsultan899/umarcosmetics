import { cn } from "@/lib/utils";

export function Skeleton({
  className,
}: {
  className?: string;
}) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

/** Full main-area placeholder while dashboard pages stream in. */
export function PageSkeleton() {
  return (
    <div
      className="animate-rise space-y-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading page"
    >
      <span className="absolute -m-px h-px w-px overflow-hidden border-0 p-0 whitespace-nowrap [clip:rect(0,0,0,0)]">
        Loading…
      </span>

      {/* Heading */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-9 w-56 sm:w-72" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        <Skeleton className="h-10 w-28 rounded-lg" />
      </div>

      {/* Stat tiles */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="stat-tile space-y-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>

      {/* Charts / panels */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <div className="panel-header">
            <Skeleton className="h-4 w-36" />
          </div>
          <div className="panel-body">
            <Skeleton className="h-48 w-full rounded-[var(--radius-sm)]" />
          </div>
        </div>
        <div className="panel">
          <div className="panel-header">
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="panel-body">
            <Skeleton className="h-48 w-full rounded-[var(--radius-sm)]" />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="panel overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-9 w-40 rounded-lg" />
        </div>
        <div className="space-y-0 p-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-4 gap-3 border-b border-[var(--border)] px-3 py-3 last:border-0 sm:grid-cols-6"
            >
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="hidden h-4 w-full sm:block" />
              <Skeleton className="hidden h-4 w-full sm:block" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2 justify-self-end" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Compact shell loader when full app chrome is not mounted yet. */
export function ShellSkeleton() {
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)]">
      <div className="hidden w-[280px] shrink-0 bg-[var(--sidebar)] lg:block">
        <div className="space-y-3 p-5">
          <Skeleton className="h-8 w-36 bg-white/10" />
          <Skeleton className="mt-8 h-4 w-20 bg-white/10" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-lg bg-white/10" />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center gap-3 border-b border-[var(--border)] bg-white/80 px-4">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-4 w-40" />
          <div className="flex-1" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
        <div className="flex-1 overflow-hidden p-4 sm:p-6">
          <PageSkeleton />
        </div>
      </div>
    </div>
  );
}

import { cn } from "@/lib/utils";

export function ChartCard({
  title,
  subtitle,
  children,
  className,
  action,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className={cn("panel flex h-full flex-col p-5", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-xs text-[var(--muted)]">{subtitle}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

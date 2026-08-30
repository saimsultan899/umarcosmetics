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
    <div className={cn("panel flex h-full flex-col", className)}>
      <div className="panel-header">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--ink)]">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs font-medium text-[var(--muted)]">
              {subtitle}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="panel-body min-h-0 flex-1">{children}</div>
    </div>
  );
}

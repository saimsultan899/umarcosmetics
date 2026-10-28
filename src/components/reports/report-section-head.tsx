import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** Title + actions bar used above report / cash tables. */
export function ReportSectionHead({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("report-section-head", className)}>
      <div className="report-section-head__text">
        <h2 className="report-section-head__title">{title}</h2>
        {subtitle ? (
          <div className="report-section-head__subtitle">{subtitle}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="report-section-head__actions">{actions}</div>
      ) : null}
    </div>
  );
}

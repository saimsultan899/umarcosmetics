import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** Title + actions bar used on report pages and above report tables. */
export function ReportSectionHead({
  title,
  subtitle,
  actions,
  className,
  size = "section",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** `page` = report screen title; `section` = table block title. */
  size?: "section" | "page";
}) {
  const Heading = size === "page" ? "h1" : "h2";
  return (
    <div
      className={cn(
        "report-section-head",
        size === "page" && "report-section-head--page",
        className,
      )}
    >
      <div className="report-section-head__text">
        <Heading className="report-section-head__title">{title}</Heading>
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

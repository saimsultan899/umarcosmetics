"use client";

import { cn } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";
import {
  type ReactNode,
  startTransition,
  useEffect,
  useState,
} from "react";

const STORAGE_KEY = "umar.dashboard.hideStats";

function readHidden(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHidden(hidden: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, hidden ? "1" : "0");
  } catch {
    // ignore quota / private mode
  }
}

/** Collapsible dashboard summary cards with eye show/hide (persists locally). */
export function DashboardStatsPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [hidden, setHidden] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setHidden(readHidden());
    setReady(true);
  }, []);

  function toggle() {
    startTransition(() => {
      setHidden((prev) => {
        const next = !prev;
        writeHidden(next);
        return next;
      });
    });
  }

  if (!ready) {
    return <div className={cn("dashboard-stats-panel", className)}>{children}</div>;
  }

  if (hidden) {
    return (
      <div className={cn("dashboard-stats-panel dashboard-stats-panel--hidden", className)}>
        <button
          type="button"
          className="dashboard-stats-panel__reveal"
          onClick={toggle}
          aria-pressed="true"
          aria-label="Show dashboard summary cards"
        >
          <Eye className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-[var(--ink)]">
              Summary hidden
            </span>
            <span className="block text-xs text-[var(--muted)]">
              Tap the eye to show today&apos;s sales, cash, and balances
            </span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className={cn("dashboard-stats-panel dashboard-stats-panel--open", className)}>
      <div className="dashboard-stats-panel__toolbar">
        <button
          type="button"
          className="dashboard-stats-panel__eye"
          onClick={toggle}
          aria-pressed="false"
          aria-label="Hide dashboard summary cards"
          title="Hide summary"
        >
          <EyeOff className="h-4 w-4" aria-hidden />
          <span className="dashboard-stats-panel__eye-label">Hide</span>
        </button>
      </div>
      {children}
    </div>
  );
}

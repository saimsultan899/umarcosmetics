"use client";

import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 animate-[dialog-fade_160ms_ease-out] bg-[#0b1915]/55 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative z-[101] flex max-h-[min(90vh,880px)] w-full max-w-2xl flex-col overflow-hidden",
          "animate-[dialog-rise_180ms_ease-out] rounded-2xl bg-white",
          "shadow-[0_24px_80px_rgba(11,25,21,0.35)] ring-1 ring-black/5",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] bg-white px-5 py-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--ink)]"
            >
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-sm text-[var(--muted)]">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto bg-white px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

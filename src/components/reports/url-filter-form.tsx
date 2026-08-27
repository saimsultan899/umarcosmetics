"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Report filter form that updates search params via App Router navigation
 * instead of a full document GET (which remounts the page and feels like a refresh).
 */
export function UrlFilterForm({
  action,
  className,
  children,
}: {
  action?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const params = new URLSearchParams();
    for (const [key, value] of data.entries()) {
      const v = String(value).trim();
      if (v) params.set(key, v);
    }
    const base = action || pathname;
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${base}?${qs}` : base, { scroll: false });
    });
  }

  return (
    <form
      action={action || pathname}
      method="get"
      onSubmit={onSubmit}
      aria-busy={isPending}
      className={
        isPending
          ? `${className ?? ""} pointer-events-none opacity-60`.trim()
          : className
      }
    >
      {children}
    </form>
  );
}

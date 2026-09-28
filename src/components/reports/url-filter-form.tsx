"use client";

import { Button } from "@/components/ui/button";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useTransition } from "react";

const UrlFilterPendingContext = createContext(false);

export function useUrlFilterPending() {
  return useContext(UrlFilterPendingContext);
}

/** Submit control for report filters. Spins while the filter navigation is running. */
export function FilterSubmitButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const pending = useUrlFilterPending();
  return (
    <Button type="submit" loading={pending} className={className}>
      {children}
    </Button>
  );
}

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
      className={className}
    >
      <UrlFilterPendingContext.Provider value={isPending}>
        {children}
      </UrlFilterPendingContext.Provider>
    </form>
  );
}

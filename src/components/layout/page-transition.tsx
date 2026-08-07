"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";

function PageTransitionInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const key = `${pathname}?${searchParams.toString()}`;

  return (
    <div key={key} className="animate-page-in">
      {children}
    </div>
  );
}

/** Soft enter animation when route content swaps. */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={children}>
      <PageTransitionInner>{children}</PageTransitionInner>
    </Suspense>
  );
}

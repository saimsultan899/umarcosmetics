"use client";

import { usePathname } from "next/navigation";
import { type ReactNode } from "react";

/**
 * Soft enter animation when the route (pathname) changes.
 *
 * Keyed on pathname only — NOT search params — so paginating, filtering or
 * searching a table (which only changes the query string) updates the rows in
 * place instead of remounting and re-animating the whole page.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="animate-page-in">
      {children}
    </div>
  );
}

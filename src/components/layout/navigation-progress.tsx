"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, Suspense } from "react";

/**
 * Slim top progress bar for route changes — instant feedback before the
 * page skeleton / content arrives.
 */
function NavigationProgressInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);
  const [done, setDone] = useState(false);
  const key = `${pathname}?${searchParams.toString()}`;
  const prevKey = useRef(key);
  const completeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (prevKey.current === key) return;
    prevKey.current = key;

    if (completeTimer.current) clearTimeout(completeTimer.current);
    if (startTimer.current) clearTimeout(startTimer.current);

    setDone(false);
    setActive(true);

    // Finish shortly after the new tree paints
    startTimer.current = setTimeout(() => {
      setDone(true);
      completeTimer.current = setTimeout(() => {
        setActive(false);
        setDone(false);
      }, 280);
    }, 180);

    return () => {
      if (completeTimer.current) clearTimeout(completeTimer.current);
      if (startTimer.current) clearTimeout(startTimer.current);
    };
  }, [key]);

  // Capture internal <a> clicks for progress start even before RSC response
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a");
      if (!anchor) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (anchor.target === "_blank") return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
      try {
        const url = new URL(href, window.location.origin);
        if (url.origin !== window.location.origin) return;
        if (
          url.pathname === window.location.pathname &&
          url.search === window.location.search
        ) {
          return;
        }
      } catch {
        return;
      }
      setDone(false);
      setActive(true);
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  if (!active) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-[3px]"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Page loading"
    >
      <div
        className={`nav-progress-bar h-full ${done ? "nav-progress-bar--done" : "nav-progress-bar--run"}`}
      />
    </div>
  );
}

export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <NavigationProgressInner />
    </Suspense>
  );
}

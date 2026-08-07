"use client";

import { adminNav, mainNav, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { ChevronDown, Layers3, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

function parseHref(href: string) {
  return new URL(href, "http://local");
}

function hrefSpecificity(href: string) {
  const url = parseHref(href);
  return (
    (url.hash ? 100 : 0) +
    [...url.searchParams.keys()].length * 10 +
    url.pathname.length
  );
}

/** Path/query/hash match — may return multiple candidates; use pickActiveHref. */
function isHrefCandidate(
  href: string,
  pathname: string,
  searchParams: URLSearchParams,
  hash: string,
) {
  const url = parseHref(href);
  if (url.pathname !== pathname) return false;

  const required = [...url.searchParams.entries()];
  if (required.length === 0) {
    if (searchParams.toString() !== "") return false;
  } else if (!required.every(([key, value]) => searchParams.get(key) === value)) {
    return false;
  }

  if (url.hash) {
    return hash === url.hash;
  }

  return true;
}

/** Among matching links, keep only the most specific (hash > query > bare path). */
function pickActiveHref(
  hrefs: string[],
  pathname: string,
  searchParams: URLSearchParams,
  hash: string,
) {
  const matches = hrefs
    .filter((href) => isHrefCandidate(href, pathname, searchParams, hash))
    .sort((a, b) => hrefSpecificity(b) - hrefSpecificity(a));
  return matches[0] ?? null;
}

function groupHasActiveChild(
  item: NavItem,
  pathname: string,
  searchParams: URLSearchParams,
  hash: string,
) {
  if (!item.children?.length) return false;
  return Boolean(
    pickActiveHref(
      item.children.map((c) => c.href),
      pathname,
      searchParams,
      hash,
    ),
  );
}

function NavGroup({
  item,
  pathname,
  searchParams,
  hash,
  open,
  onToggle,
  onNavigate,
  onHashChange,
}: {
  item: NavItem;
  pathname: string;
  searchParams: URLSearchParams;
  hash: string;
  open: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
  onHashChange?: (hash: string) => void;
}) {
  const childHrefs = item.children?.map((c) => c.href) ?? [];
  const activeChildHref = pickActiveHref(
    childHrefs,
    pathname,
    searchParams,
    hash,
  );
  const childActive = Boolean(activeChildHref);
  const selfActive = item.href
    ? pickActiveHref([item.href], pathname, searchParams, hash) === item.href
    : false;
  const Icon = item.icon;

  if (!item.children?.length && item.href) {
    return (
      <Link
        href={item.href}
        onClick={() => {
          const url = parseHref(item.href!);
          onHashChange?.(url.hash || "");
          onNavigate?.();
        }}
        className={cn(
          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
          selfActive
            ? "bg-[var(--brand)] text-white shadow-sm"
            : "text-[var(--sidebar-ink)] hover:bg-white/10 hover:text-white",
        )}
      >
        {Icon ? <Icon className="h-4 w-4 shrink-0 opacity-90" /> : null}
        {item.label}
      </Link>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
          childActive
            ? "bg-white/10 text-white"
            : "text-[var(--sidebar-ink)] hover:bg-white/10 hover:text-white",
        )}
      >
        {Icon ? <Icon className="h-4 w-4 shrink-0 opacity-90" /> : null}
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronDown
          className={cn("h-4 w-4 transition", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="mt-1 ml-5 space-y-0.5 border-l border-white/10 pl-3">
          {item.children?.map((child) => {
            const active = activeChildHref === child.href;
            return (
              <Link
                key={child.href}
                href={child.href}
                onClick={() => {
                  const url = parseHref(child.href);
                  onHashChange?.(url.hash || "");
                  onNavigate?.();
                }}
                className={cn(
                  "block rounded-lg px-2.5 py-2 text-[13px] transition",
                  active
                    ? "bg-[var(--brand)] text-white"
                    : "text-[var(--sidebar-ink)] hover:bg-white/10 hover:text-white",
                )}
              >
                {child.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar({
  companyName,
  isSuperAdmin,
  mobileOpen = false,
  onMobileClose,
}: {
  companyName?: string | null;
  isSuperAdmin?: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [hash, setHash] = useState("");

  useEffect(() => {
    const sync = () => setHash(window.location.hash || "");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [pathname, searchParams]);

  const allGroups = useMemo(
    () => [...mainNav, ...(isSuperAdmin ? adminNav : [])],
    [isSuperAdmin],
  );

  const activeGroupLabel = useMemo(() => {
    const match = allGroups.find((item) =>
      groupHasActiveChild(item, pathname, searchParams, hash),
    );
    return match?.label ?? null;
  }, [allGroups, pathname, searchParams, hash]);

  const [openLabel, setOpenLabel] = useState<string | null>(activeGroupLabel);

  useEffect(() => {
    if (activeGroupLabel) setOpenLabel(activeGroupLabel);
  }, [activeGroupLabel]);

  function toggleGroup(label: string) {
    setOpenLabel((current) => (current === label ? null : label));
  }

  return (
    <aside
      className={cn(
        "flex h-full w-[min(280px,85vw)] shrink-0 flex-col bg-[var(--sidebar)] text-white",
        "fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out",
        "lg:static lg:z-0 lg:w-[280px] lg:translate-x-0",
        mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full",
      )}
    >
      <div className="border-b border-white/10 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand)] shadow-lg shadow-teal-900/30">
            <Layers3 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight">
              Umar Distribution
            </p>
            <p className="truncate text-xs text-[var(--sidebar-ink)]">
              {companyName || "Select a company"}
            </p>
          </div>
          <button
            type="button"
            onClick={onMobileClose}
            className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {mainNav.map((item) => (
          <NavGroup
            key={item.label}
            item={item}
            pathname={pathname}
            searchParams={searchParams}
            hash={hash}
            open={openLabel === item.label}
            onToggle={() => toggleGroup(item.label)}
            onNavigate={onMobileClose}
            onHashChange={setHash}
          />
        ))}

        {isSuperAdmin ? (
          <div className="pt-4">
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
              Platform
            </p>
            {adminNav.map((item) => (
              <NavGroup
                key={item.label}
                item={item}
                pathname={pathname}
                searchParams={searchParams}
                hash={hash}
                open={openLabel === item.label}
                onToggle={() => toggleGroup(item.label)}
                onNavigate={onMobileClose}
                onHashChange={setHash}
              />
            ))}
          </div>
        ) : null}
      </nav>

      <div className="border-t border-white/10 px-4 py-4">
        <div className="rounded-xl bg-white/5 px-3 py-3 text-xs text-[var(--sidebar-ink)]">
          <p className="font-medium text-white/90">Offline ready</p>
          <p className="mt-1 leading-relaxed">
            Day work local · Night sync to cloud
          </p>
        </div>
      </div>
    </aside>
  );
}

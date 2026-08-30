"use client";

import { mainNav, platformNav, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { ChevronDown, Layers3, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

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
  collapsed,
  onToggle,
  onNavigate,
  onHashChange,
}: {
  item: NavItem;
  pathname: string;
  searchParams: URLSearchParams;
  hash: string;
  open: boolean;
  collapsed: boolean;
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
  const anchorRef = useRef<HTMLDivElement>(null);
  const [flyout, setFlyout] = useState(false);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(
    null,
  );

  function openFlyout() {
    if (!collapsed || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const maxTop = Math.max(8, window.innerHeight - 280);
    setFlyoutPos({
      top: Math.min(rect.top, maxTop),
      left: rect.right + 6,
    });
    setFlyout(true);
  }

  function closeFlyout() {
    setFlyout(false);
    setFlyoutPos(null);
  }

  const rowIcon = Icon ? (
    <span className="sidebar-link__icon">
      <Icon className="h-[17px] w-[17px]" />
    </span>
  ) : (
    <span className="sidebar-link__icon" />
  );

  if (!item.children?.length && item.href) {
    return (
      <Link
        href={item.href}
        title={item.label}
        onClick={() => {
          const url = parseHref(item.href!);
          onHashChange?.(url.hash || "");
          onNavigate?.();
        }}
        className={cn(
          "sidebar-link",
          collapsed && "sidebar-link--collapsed",
          selfActive && "sidebar-link--active",
        )}
      >
        {collapsed ? (
          rowIcon
        ) : (
          <>
            {rowIcon}
            <span className="sidebar-link__label">{item.label}</span>
            <span className="sidebar-link__chevron sidebar-link__chevron--empty" aria-hidden />
          </>
        )}
        {collapsed ? <span className="sr-only">{item.label}</span> : null}
      </Link>
    );
  }

  return (
    <div
      ref={anchorRef}
      className="relative"
      onMouseEnter={() => collapsed && openFlyout()}
      onMouseLeave={() => closeFlyout()}
    >
      <button
        type="button"
        onClick={() => {
          if (collapsed) {
            if (flyout) closeFlyout();
            else openFlyout();
          } else {
            onToggle();
          }
        }}
        title={item.label}
        aria-expanded={open}
        className={cn(
          "sidebar-link w-full",
          collapsed && "sidebar-link--collapsed",
          childActive && "sidebar-link--parent-active",
        )}
      >
        {collapsed ? (
          rowIcon
        ) : (
          <>
            {rowIcon}
            <span className="sidebar-link__label">{item.label}</span>
            <span
              className={cn("sidebar-link__chevron", open && "sidebar-link__chevron--open")}
              aria-hidden
            >
              <ChevronDown className="h-4 w-4" />
            </span>
          </>
        )}
        {collapsed ? <span className="sr-only">{item.label}</span> : null}
      </button>

      {!collapsed && open ? (
        <div className="mt-0.5 ml-3 space-y-0.5 border-l border-[var(--sidebar-border)] pl-2">
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
                className={cn("sidebar-sublink", active && "sidebar-sublink--active")}
              >
                {child.label}
              </Link>
            );
          })}
        </div>
      ) : null}

      {collapsed && flyout && flyoutPos ? (
        <div
          className="sidebar-flyout sidebar-flyout--fixed"
          style={{ top: flyoutPos.top, left: flyoutPos.left }}
        >
          <p className="sidebar-flyout__title">{item.label}</p>
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
                  closeFlyout();
                }}
                className={cn("sidebar-sublink", active && "sidebar-sublink--active")}
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
  collapsed = false,
  onMobileClose,
  onToggleCollapsed,
}: {
  companyName?: string | null;
  isSuperAdmin?: boolean;
  mobileOpen?: boolean;
  collapsed?: boolean;
  onMobileClose?: () => void;
  onToggleCollapsed?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [hash, setHash] = useState("");
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const iconMode = Boolean(collapsed && desktop);

  useEffect(() => {
    const sync = () => setHash(window.location.hash || "");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [pathname, searchParams]);

  const allGroups = useMemo(
    () => [...mainNav, ...(isSuperAdmin ? [platformNav] : [])],
    [isSuperAdmin],
  );

  const activeGroupLabel = useMemo(() => {
    const match = allGroups.find((item) =>
      groupHasActiveChild(item, pathname, searchParams, hash),
    );
    return match?.label ?? null;
  }, [allGroups, pathname, searchParams, hash]);

  const platformActive = groupHasActiveChild(
    platformNav,
    pathname,
    searchParams,
    hash,
  );

  const [openLabel, setOpenLabel] = useState<string | null>(activeGroupLabel);
  const [platformOpen, setPlatformOpen] = useState(platformActive);

  useEffect(() => {
    if (activeGroupLabel) setOpenLabel(activeGroupLabel);
  }, [activeGroupLabel]);

  useEffect(() => {
    if (platformActive) setPlatformOpen(true);
  }, [platformActive]);

  function toggleGroup(label: string) {
    if (iconMode) return;
    setPlatformOpen(false);
    setOpenLabel((current) => (current === label ? null : label));
  }

  function togglePlatform() {
    if (iconMode) return;
    setOpenLabel(null);
    setPlatformOpen((v) => !v);
  }

  return (
    <aside
      className={cn(
        "sidebar-shell flex h-full shrink-0 flex-col",
        "fixed inset-y-0 left-0 z-50 transition-[width,transform] duration-200 ease-out",
        "lg:static lg:z-0 lg:translate-x-0",
        collapsed ? "lg:w-[68px]" : "lg:w-[252px]",
        "w-[min(272px,85vw)]",
        mobileOpen ? "translate-x-0 shadow-lg" : "-translate-x-full",
      )}
    >
      <div
        className={cn(
          "sidebar-brand flex h-14 items-center sm:h-[3.75rem]",
          iconMode ? "justify-center px-2" : "gap-2.5 px-3",
        )}
      >
        <div className="sidebar-brand__mark">
          <Layers3 className="h-4 w-4" />
        </div>
        {!iconMode ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[var(--ink)]">
              Umar Distribution
            </p>
            <p className="truncate text-[11px] text-[var(--muted)]">
              {companyName || "Select a company"}
            </p>
          </div>
        ) : null}
        <button
          type="button"
          onClick={onMobileClose}
          className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--sidebar-2)] hover:text-[var(--ink)] lg:hidden"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav
        className={cn(
          "flex flex-1 flex-col py-2",
          iconMode ? "overflow-x-hidden overflow-y-auto px-1.5" : "overflow-y-auto px-2",
        )}
      >
        <div className="flex flex-col gap-0.5">
          {mainNav.map((item) => (
            <NavGroup
              key={item.label}
              item={item}
              pathname={pathname}
              searchParams={searchParams}
              hash={hash}
              collapsed={iconMode}
              open={!iconMode && openLabel === item.label}
              onToggle={() => toggleGroup(item.label)}
              onNavigate={onMobileClose}
              onHashChange={setHash}
            />
          ))}

          {isSuperAdmin ? (
            <>
              <div className="my-1.5 border-t border-[var(--sidebar-border)]" />
              <NavGroup
                item={platformNav}
                pathname={pathname}
                searchParams={searchParams}
                hash={hash}
                collapsed={iconMode}
                open={!iconMode && platformOpen}
                onToggle={togglePlatform}
                onNavigate={onMobileClose}
                onHashChange={setHash}
              />
            </>
          ) : null}
        </div>
      </nav>

      <div
        className={cn(
          "sidebar-footer hidden p-2 lg:block",
          collapsed && "flex justify-center",
        )}
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          className={cn("sidebar-toggle", collapsed && "sidebar-toggle--collapsed")}
          aria-label={collapsed ? "Open sidebar" : "Close sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-[17px] w-[17px]" />
          ) : (
            <>
              <PanelLeftClose className="h-[17px] w-[17px]" />
              <span className="sidebar-link__label">Close sidebar</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

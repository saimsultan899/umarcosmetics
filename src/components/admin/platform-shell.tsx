"use client";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  Building2,
  Layers3,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  UserPlus,
  Users,
  Boxes,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const NAV = [
  {
    href: "/super-admin",
    label: "Overview",
    icon: LayoutDashboard,
    exact: true,
  },
  {
    href: "/super-admin/provision",
    label: "New client",
    icon: UserPlus,
  },
  {
    href: "/super-admin/clients",
    label: "Clients",
    icon: Users,
  },
  {
    href: "/super-admin/organizations",
    label: "Organizations",
    icon: Building2,
  },
  {
    href: "/super-admin/companies",
    label: "Companies",
    icon: Boxes,
  },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PlatformShell({
  children,
  userName,
}: {
  children: React.ReactNode;
  userName?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("umar-platform-sidebar") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const iconMode = Boolean(collapsed && desktop);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem("umar-platform-sidebar", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)]">
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-black/45 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

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
            <Shield className="h-4 w-4" />
          </div>
          {!iconMode ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[var(--ink)]">
                Super Admin
              </p>
              <p className="truncate text-[11px] text-[var(--muted)]">
                Platform control
              </p>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--sidebar-2)] hover:text-[var(--ink)] lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={iconMode ? item.label : undefined}
                className={cn(
                  "sidebar-link",
                  iconMode && "sidebar-link--truncated",
                  active && "sidebar-link--active",
                )}
              >
                <span className="sidebar-link__icon">
                  <Icon className="h-4 w-4" />
                </span>
                {!iconMode ? (
                  <span className="sidebar-link__label">{item.label}</span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-[var(--sidebar-border)] p-2">
          <Link
            href="/select-company"
            title={iconMode ? "Company picker" : undefined}
            className={cn(
              "sidebar-link",
              iconMode && "sidebar-link--truncated",
            )}
          >
            <span className="sidebar-link__icon">
              <Layers3 className="h-4 w-4" />
            </span>
            {!iconMode ? (
              <span className="sidebar-link__label">Company picker</span>
            ) : null}
          </Link>
          <button
            type="button"
            onClick={toggleCollapsed}
            className={cn(
              "sidebar-link hidden w-full lg:flex",
              iconMode && "sidebar-link--truncated",
            )}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <span className="sidebar-link__icon">
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </span>
            {!iconMode ? (
              <span className="sidebar-link__label">Collapse</span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            className={cn(
              "sidebar-link w-full",
              iconMode && "sidebar-link--truncated",
            )}
            title="Logout"
          >
            <span className="sidebar-link__icon">
              <LogOut className="h-4 w-4" />
            </span>
            {!iconMode ? (
              <span className="sidebar-link__label">Logout</span>
            ) : null}
          </button>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-white px-4 sm:h-[3.75rem] sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">
                SaaS platform
              </p>
              <p className="truncate text-sm font-semibold text-[var(--ink)]">
                {NAV.find((n) => isActive(pathname, n.href, n.exact))?.label ||
                  "Super Admin"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden max-w-[180px] truncate text-xs text-[var(--muted)] sm:inline">
              {userName || "Super Admin"}
            </span>
            <Link
              href="/super-admin/provision"
              className="inline-flex rounded-lg bg-[var(--brand)] px-3 py-2 text-xs font-semibold !text-white"
            >
              New client
            </Link>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[var(--background)] p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

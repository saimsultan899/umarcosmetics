"use client";

import { PlatformShell } from "@/components/admin/platform-shell";
import { NavigationProgress } from "@/components/layout/navigation-progress";
import { PageTransition } from "@/components/layout/page-transition";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { OfflineBanner } from "@/components/offline/offline-banner";
import { SyncProvider } from "@/components/offline/sync-provider";
import { installDesktopPrint } from "@/lib/desktop-print";
import type { Company } from "@/lib/types/database";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function AppShell({
  children,
  company,
  userName,
  isSuperAdmin,
  profileData,
  membershipsData,
}: {
  children: React.ReactNode;
  company?: Company | null;
  userName?: string | null;
  isSuperAdmin?: boolean;
  profileData?: Record<string, unknown> | null;
  membershipsData?: Record<string, unknown>[] | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    installDesktopPrint();
    try {
      setSidebarCollapsed(localStorage.getItem("umar-sidebar-collapsed") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem("umar-sidebar-collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const selectShell =
    pathname === "/select-company" || pathname.startsWith("/select-company/");
  const platformShell =
    pathname === "/super-admin" || pathname.startsWith("/super-admin/");

  // Platform accounts must never sit in the tenant ERP shell.
  useEffect(() => {
    if (isSuperAdmin && !platformShell && !selectShell) {
      router.replace("/super-admin");
    }
  }, [isSuperAdmin, platformShell, selectShell, router]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen]);

  if (selectShell) {
    return (
      <div className="min-h-screen overflow-y-auto bg-white">
        <NavigationProgress />
        <PageTransition>{children}</PageTransition>
      </div>
    );
  }

  if (platformShell) {
    return (
      <div className="min-h-screen overflow-y-auto">
        <NavigationProgress />
        <PlatformShell userName={userName}>
          <PageTransition>{children}</PageTransition>
        </PlatformShell>
      </div>
    );
  }

  if (isSuperAdmin) {
    return (
      <div className="min-h-screen overflow-y-auto bg-white">
        <NavigationProgress />
      </div>
    );
  }

  return (
    <SyncProvider
      companyId={company?.id}
      organizationId={company?.organization_id}
      userName={userName}
      profileData={profileData}
      companyData={company as unknown as Record<string, unknown> | null}
      membershipsData={membershipsData}
    >
      <div className="flex h-screen overflow-hidden">
        <NavigationProgress />
        {mobileNavOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-40 bg-black/45 lg:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
        ) : null}

        <Sidebar
          companyName={company?.name}
          isSuperAdmin={false}
          mobileOpen={mobileNavOpen}
          collapsed={sidebarCollapsed}
          onMobileClose={() => setMobileNavOpen(false)}
          onToggleCollapsed={toggleSidebarCollapsed}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--background)]">
          <Topbar
            company={company}
            userName={userName}
            onMenuClick={() => setMobileNavOpen(true)}
          />
          <OfflineBanner companyId={company?.id} />
          <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[var(--background)] p-4 sm:p-6">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
      </div>
    </SyncProvider>
  );
}

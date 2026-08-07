"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { SyncProvider } from "@/components/offline/sync-provider";
import type { Company } from "@/lib/types/database";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function AppShell({
  children,
  company,
  userName,
  isSuperAdmin,
}: {
  children: React.ReactNode;
  company?: Company | null;
  userName?: string | null;
  isSuperAdmin?: boolean;
}) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Company picker is a focused screen — no sidebar/topbar until a company is chosen
  const bareShell =
    pathname === "/select-company" || pathname.startsWith("/select-company/");

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

  if (bareShell) {
    return (
      <div className="min-h-screen overflow-y-auto bg-[var(--background)]">
        {/* Full-bleed company picker — page owns its own padding */}
        {children}
      </div>
    );
  }

  return (
    <SyncProvider
      companyId={company?.id}
      organizationId={company?.organization_id}
    >
      <div className="flex h-screen overflow-hidden">
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
          isSuperAdmin={isSuperAdmin}
          mobileOpen={mobileNavOpen}
          onMobileClose={() => setMobileNavOpen(false)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            company={company}
            userName={userName}
            onMenuClick={() => setMobileNavOpen(true)}
          />
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </SyncProvider>
  );
}

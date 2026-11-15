"use client";

import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Store,
  Wallet,
  ShoppingCart,
  ClipboardList,
  Cloud,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items: Array<{
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
}> = [
  { href: "/field", label: "Home", icon: LayoutDashboard },
  { href: "/field/shops", label: "Shops", icon: Store },
  { href: "/field/order", label: "Order", icon: ClipboardList },
  { href: "/field/sale", label: "Sale", icon: ShoppingCart, permission: "create_invoices" },
  { href: "/field/recovery", label: "Collect", icon: Wallet, permission: "create_vouchers" },
  { href: "/settings/sync", label: "Sync", icon: Cloud },
];

export function FieldMobileNav({
  permissions,
  locked = false,
}: {
  permissions?: string[];
  /** Salesman login: hide anything they were not granted. */
  locked?: boolean;
}) {
  const pathname = usePathname();
  const visible = items.filter(
    (item) => !locked || !item.permission || permissions?.includes(item.permission),
  );
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-white/95 px-2 py-2 backdrop-blur md:hidden">
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}
      >
        {visible.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/field"
              ? pathname === "/field"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-1 rounded-[var(--radius-sm)] px-1 py-2 text-[11px] font-medium",
                active ? "bg-[var(--brand-soft)] text-[var(--brand)]" : "text-[var(--muted)]",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

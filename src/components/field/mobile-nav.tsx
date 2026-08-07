"use client";

import { cn } from "@/lib/utils";
import { LayoutDashboard, Store, Wallet, ShoppingCart, Cloud } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/field", label: "Home", icon: LayoutDashboard },
  { href: "/field/shops", label: "Shops", icon: Store },
  { href: "/field/recovery", label: "Collect", icon: Wallet },
  { href: "/field/sale", label: "Sale", icon: ShoppingCart },
  { href: "/settings/sync", label: "Sync", icon: Cloud },
];

export function FieldMobileNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-white/95 px-2 py-2 backdrop-blur md:hidden">
      <div className="grid grid-cols-5 gap-1">
        {items.map((item) => {
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
                "flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium",
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

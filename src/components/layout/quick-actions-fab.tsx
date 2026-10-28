"use client";

import { cn } from "@/lib/utils";
import {
  Archive,
  Banknote,
  BookOpen,
  ClipboardList,
  HandCoins,
  LayoutDashboard,
  Package,
  Plus,
  Receipt,
  RotateCcw,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

type FabAction = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  permission?: string;
};

const ACTIONS: FabAction[] = [
  {
    id: "recovery",
    label: "Record recovery",
    href: "/reports/recovery?create=recovery",
    icon: Wallet,
    permission: "create_vouchers",
  },
  {
    id: "cash-receipt",
    label: "Cash receipt",
    href: "/vouchers/cash-receipt?create=cash-receipt",
    icon: Receipt,
    permission: "create_vouchers",
  },
  {
    id: "sale",
    label: "New sale",
    href: "/sales/invoices?create=sale",
    icon: ShoppingCart,
    permission: "create_invoices",
  },
  {
    id: "sale-return",
    label: "Sale return",
    href: "/sales/returns?create=sale-return",
    icon: RotateCcw,
    permission: "create_invoices",
  },
  {
    id: "purchase",
    label: "New purchase",
    href: "/purchases/invoices?create=purchase",
    icon: Truck,
    permission: "create_purchases",
  },
  {
    id: "gate-pass",
    label: "Gate pass",
    href: "/purchases/gate-passes?create=gate-pass",
    icon: ClipboardList,
    permission: "create_purchases",
  },
  {
    id: "purchase-return",
    label: "Purchase return",
    href: "/purchases/returns?create=purchase-return",
    icon: RotateCcw,
    permission: "create_purchases",
  },
  {
    id: "cash-payment",
    label: "Cash payment",
    href: "/vouchers/cash-payment?create=cash-payment",
    icon: HandCoins,
    permission: "create_vouchers",
  },
  {
    id: "expense",
    label: "Daily expense",
    href: "/vouchers/expenses?create=expense",
    icon: Banknote,
    permission: "create_vouchers",
  },
  {
    id: "journal",
    label: "Journal voucher",
    href: "/vouchers/journal?create=journal",
    icon: BookOpen,
    permission: "create_vouchers",
  },
  {
    id: "customers",
    label: "Customers / shops",
    href: "/parties?type=customer",
    icon: Users,
    permission: "edit_customers",
  },
  {
    id: "products",
    label: "Products",
    href: "/products",
    icon: Package,
    permission: "edit_products",
  },
  {
    id: "expiry",
    label: "Expiry warehouse",
    href: "/inventory/expiry",
    icon: Archive,
  },
  {
    id: "ledger",
    label: "Customer ledger",
    href: "/reports/accounts?view=ledger",
    icon: BookOpen,
    permission: "view_reports",
  },
  {
    id: "receivables",
    label: "Receivables",
    href: "/reports/accounts?view=receivable",
    icon: Wallet,
    permission: "view_reports",
  },
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
];

export function QuickActionsFab({
  permissions = [],
}: {
  permissions?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const actions = useMemo(
    () =>
      ACTIONS.filter(
        (action) =>
          !action.permission || permissions.includes(action.permission),
      ),
    [permissions],
  );

  // Field app has its own bottom nav — keep this ERP FAB off those screens.
  const hidden =
    pathname.startsWith("/field") ||
    pathname.startsWith("/select-company") ||
    pathname.startsWith("/super-admin") ||
    actions.length === 0;

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onPointer(e: MouseEvent | TouchEvent) {
      const el = rootRef.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (target && !el.contains(target)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (hidden) return null;

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <div
      ref={rootRef}
      className="quick-fab"
      data-open={open ? "true" : "false"}
    >
      {open ? (
        <button
          type="button"
          className="quick-fab__scrim"
          aria-label="Close shortcuts"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <div className="quick-fab__stack" aria-hidden={!open}>
        {actions.map((action, index) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              className="quick-fab__action"
              style={{ "--fab-i": Math.min(actions.length - index, 8) } as CSSProperties}
              tabIndex={open ? 0 : -1}
              onClick={() => go(action.href)}
            >
              <span className="quick-fab__action-label">{action.label}</span>
              <span className="quick-fab__action-icon">
                <Icon className="h-3 w-3" aria-hidden />
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className={cn("quick-fab__toggle", open && "quick-fab__toggle--open")}
        aria-expanded={open}
        aria-label={open ? "Close shortcuts" : "Quick shortcuts"}
        onClick={() => setOpen((v) => !v)}
      >
        <Plus
          className={cn(
            "h-5 w-5 transition-transform duration-200",
            open && "scale-0 rotate-90 opacity-0",
          )}
          aria-hidden
        />
        <X
          className={cn(
            "absolute h-5 w-5 transition-transform duration-200",
            open ? "scale-100 rotate-0 opacity-100" : "scale-0 -rotate-90 opacity-0",
          )}
          aria-hidden
        />
      </button>
    </div>
  );
}

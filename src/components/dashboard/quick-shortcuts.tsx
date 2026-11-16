import { cn } from "@/lib/utils";
import {
  Archive,
  BarChart3,
  Banknote,
  Building2,
  Landmark,
  ShoppingCart,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

type ShortcutTone =
  | "primary"
  | "accent"
  | "blue"
  | "mint"
  | "peach"
  | "slate"
  | "teal"
  | "purple";

const shortcuts: {
  href: string;
  label: string;
  shortLabel?: string;
  icon: LucideIcon;
  tone: ShortcutTone;
}[] = [
  {
    href: "/sales/invoices",
    label: "New sale",
    shortLabel: "Sale",
    icon: ShoppingCart,
    tone: "primary",
  },
  {
    href: "/purchases/invoices",
    label: "Purchase",
    shortLabel: "Purchase",
    icon: Truck,
    tone: "accent",
  },
  {
    href: "/vouchers/cash-management",
    label: "Cash management",
    shortLabel: "Cash book",
    icon: Landmark,
    tone: "teal",
  },
  {
    href: "/reports/company",
    label: "Company statement",
    shortLabel: "Company",
    icon: Building2,
    tone: "slate",
  },
  {
    href: "/inventory/expiry",
    label: "Expiry",
    shortLabel: "Expiry",
    icon: Archive,
    tone: "blue",
  },
  {
    href: "/reports/recovery",
    label: "Customer receivables",
    shortLabel: "Receivables",
    icon: Wallet,
    tone: "mint",
  },
  {
    href: "/vouchers/expenses",
    label: "Daily expense",
    shortLabel: "Expense",
    icon: Banknote,
    tone: "peach",
  },
  {
    href: "/reports/profit",
    label: "Profit",
    shortLabel: "Profit",
    icon: BarChart3,
    tone: "purple",
  },
];

export function QuickShortcuts({ className }: { className?: string }) {
  return (
    <div className={cn("quick-shortcuts", className)}>
      {shortcuts.map(({ href, label, shortLabel, icon: Icon, tone }) => (
        <Link
          key={href}
          href={href}
          title={label}
          className={cn("quick-shortcut", `quick-shortcut--${tone}`)}
        >
          <Icon className="quick-shortcut__icon" aria-hidden />
          <span className="quick-shortcut__label">
            <span className="quick-shortcut__label-full">{label}</span>
            {shortLabel ? (
              <span className="quick-shortcut__label-short">{shortLabel}</span>
            ) : null}
          </span>
        </Link>
      ))}
    </div>
  );
}

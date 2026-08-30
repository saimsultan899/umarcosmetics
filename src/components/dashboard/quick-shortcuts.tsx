import { cn } from "@/lib/utils";
import {
  BarChart3,
  Banknote,
  ClipboardList,
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
  | "purple";

const shortcuts: {
  href: string;
  label: string;
  icon: LucideIcon;
  tone: ShortcutTone;
}[] = [
  { href: "/sales/invoices", label: "New sale", icon: ShoppingCart, tone: "primary" },
  { href: "/purchases/invoices", label: "Purchase", icon: Truck, tone: "accent" },
  { href: "/purchases/gate-passes", label: "Gate Pass", icon: ClipboardList, tone: "blue" },
  {
    href: "/reports/recovery",
    label: "Customer receivables",
    icon: Wallet,
    tone: "mint",
  },
  { href: "/vouchers/expenses", label: "Daily expense", icon: Banknote, tone: "peach" },
  { href: "/reports/profit", label: "Profit", icon: BarChart3, tone: "purple" },
];

export function QuickShortcuts({ className }: { className?: string }) {
  return (
    <div className={cn("quick-shortcuts", className)}>
      {shortcuts.map(({ href, label, icon: Icon, tone }) => (
        <Link
          key={href}
          href={href}
          className={cn("quick-shortcut", `quick-shortcut--${tone}`)}
        >
          <Icon className="quick-shortcut__icon" aria-hidden />
          <span>{label}</span>
        </Link>
      ))}
    </div>
  );
}

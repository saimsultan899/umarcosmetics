import {
  Boxes,
  Building2,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  FileBarChart2,
  Route,
  Settings,
  Shield,
} from "lucide-react";

export type NavItem = {
  label: string;
  href?: string;
  icon?: typeof LayoutDashboard;
  children?: { label: string; href: string }[];
};

export const mainNav: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Accounts",
    icon: Users,
    children: [
      { label: "Customers / Shops", href: "/parties?type=customer" },
      { label: "Vendors", href: "/parties?type=supplier" },
      { label: "Chart of Accounts", href: "/parties?view=ledger" },
      { label: "All parties", href: "/parties" },
    ],
  },
  {
    label: "Products & Stock",
    icon: Package,
    children: [
      { label: "Products", href: "/products" },
      { label: "Low / reorder stock", href: "/products?view=reorder" },
      { label: "Companies", href: "/warehouses" },
      { label: "Stock transfer", href: "/warehouses/transfers" },
      { label: "Van load sheets", href: "/inventory/load-sheets" },
      { label: "Stock report", href: "/reports/stock" },
    ],
  },
  {
    label: "Sales",
    icon: ShoppingCart,
    children: [
      { label: "Sale invoice", href: "/sales/invoices" },
      { label: "Sale return", href: "/sales/returns" },
      { label: "Salesmen", href: "/salesman" },
      { label: "Salesmen performance", href: "/sales/salesmen" },
    ],
  },
  {
    label: "Purchases",
    icon: Truck,
    children: [
      { label: "Purchase invoice", href: "/purchases/invoices" },
      { label: "Gate pass", href: "/purchases/gate-passes" },
      { label: "Purchase return", href: "/purchases/returns" },
    ],
  },
  {
    label: "Vouchers",
    icon: Wallet,
    children: [
      { label: "Cash receipt", href: "/vouchers/cash-receipt" },
      { label: "Cash payment", href: "/vouchers/cash-payment" },
      { label: "Daily expenses & salary", href: "/vouchers/expenses" },
      { label: "Journal voucher", href: "/vouchers/journal" },
    ],
  },
  {
    label: "Field sales",
    icon: Route,
    children: [
      { label: "Field dashboard", href: "/field" },
      { label: "Recoveries", href: "/salesman/recoveries" },
      { label: "Sector sheets", href: "/salesman/routes" },
    ],
  },
  {
    label: "Reports",
    icon: FileBarChart2,
    children: [
      { label: "Sales", href: "/reports/sales" },
      { label: "Purchases", href: "/reports/purchases" },
      { label: "Stock", href: "/reports/stock" },
      { label: "Profit summary", href: "/reports/profit" },
      { label: "Expense report", href: "/reports/expenses" },
      { label: "Customer balances", href: "/reports/accounts?view=receivable" },
      { label: "Customer ledger", href: "/reports/accounts?view=ledger" },
      { label: "Recovery sheet", href: "/reports/recovery" },
      { label: "Aging report", href: "/reports/aging" },
      { label: "Salesman performance", href: "/sales/salesmen" },
      { label: "Salesman ledger", href: "/reports/salesman-ledger" },
    ],
  },
  {
    label: "Settings",
    icon: Settings,
    children: [
      { label: "Company profile", href: "/settings/company" },
      { label: "Users & roles", href: "/settings/users" },
      { label: "Offline / sync", href: "/settings/sync" },
      { label: "Night closing", href: "/settings/closing" },
    ],
  },
];

export const salesmanNav: NavItem[] = [
  { label: "Field Dashboard", href: "/field", icon: LayoutDashboard },
  { label: "My Shops", href: "/field/shops", icon: Users },
  { label: "Collect Recovery", href: "/field/recovery", icon: Wallet },
  { label: "Quick Sale", href: "/field/sale", icon: ShoppingCart },
  { label: "Sync / Closing", href: "/settings/sync", icon: Settings },
];

export const adminNav: NavItem[] = [
  {
    label: "Super Admin",
    href: "/super-admin",
    icon: Shield,
  },
  {
    label: "Organizations",
    href: "/super-admin?tab=orgs",
    icon: Building2,
  },
  {
    label: "Companies",
    href: "/super-admin?tab=companies",
    icon: Boxes,
  },
];

/** Super-admin links grouped under one sidebar dropdown. */
export const platformNav: NavItem = {
  label: "Platform",
  icon: Shield,
  children: adminNav.map(({ label, href }) => ({ label, href: href! })),
};

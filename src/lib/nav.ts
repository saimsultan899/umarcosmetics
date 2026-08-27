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
    label: "Parties / Accounts",
    icon: Users,
    children: [
      { label: "All Parties", href: "/parties" },
      { label: "Chart of Accounts", href: "/parties?view=chart" },
      { label: "Customers / Shops", href: "/parties?type=customer" },
      { label: "Suppliers", href: "/parties?type=supplier" },
      { label: "Party Ledger", href: "/reports/accounts?view=ledger" },
      { label: "Receivables", href: "/reports/accounts?view=receivable" },
      { label: "Aging Report", href: "/reports/aging" },
    ],
  },
  {
    label: "Products & Inventory",
    icon: Package,
    children: [
      { label: "Products", href: "/products" },
      { label: "Warehouses", href: "/warehouses" },
      { label: "Stock Levels", href: "/reports/stock" },
      { label: "Stock Transfer", href: "/warehouses/transfers" },
      { label: "Van Load Sheets", href: "/inventory/load-sheets" },
      { label: "Reorder Levels", href: "/products?view=reorder" },
    ],
  },
  {
    label: "Sales",
    icon: ShoppingCart,
    children: [
      { label: "Sale Invoice", href: "/sales/invoices" },
      { label: "Sale Return", href: "/sales/returns" },
      { label: "Salesmen Performance", href: "/sales/salesmen" },
    ],
  },
  {
    label: "Purchases",
    icon: Truck,
    children: [
      { label: "Purchase Invoice", href: "/purchases/invoices" },
      { label: "Purchase Return", href: "/purchases/returns" },
    ],
  },
  {
    label: "Vouchers / Accounts",
    icon: Wallet,
    children: [
      { label: "Cash Receipt", href: "/vouchers/cash-receipt" },
      { label: "Cash Payment", href: "/vouchers/cash-payment" },
      { label: "Journal Voucher", href: "/vouchers/journal" },
    ],
  },
  {
    label: "Salesman",
    icon: Route,
    children: [
      { label: "Users & Sectors", href: "/salesman" },
      { label: "Field App", href: "/field" },
      { label: "Recoveries", href: "/salesman/recoveries" },
      { label: "Sector Sheets", href: "/salesman/routes" },
    ],
  },
  {
    label: "Reports",
    icon: FileBarChart2,
    children: [
      { label: "Sale Reports", href: "/reports/sales" },
      { label: "Salesman Report", href: "/sales/salesmen" },
      { label: "Purchase Reports", href: "/reports/purchases" },
      { label: "Stock Reports", href: "/reports/stock" },
      { label: "Accounts Reports", href: "/reports/accounts" },
      { label: "Receivable Aging", href: "/reports/aging" },
      { label: "Recovery Sheet", href: "/reports/recovery" },
    ],
  },
  {
    label: "Settings",
    icon: Settings,
    children: [
      { label: "Company Profile", href: "/settings/company" },
      { label: "Catalog Copy", href: "/settings/company#catalog-copy" },
      { label: "Users & Roles", href: "/settings/users" },
      { label: "Offline / Sync", href: "/settings/sync" },
      { label: "Night Closing", href: "/settings/closing" },
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

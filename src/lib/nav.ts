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
      { label: "Expiry warehouse", href: "/inventory/expiry" },
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
      { label: "Salesman orders", href: "/sales/orders" },
      { label: "Sale return", href: "/sales/returns" },
      { label: "Expiry warehouse", href: "/inventory/expiry" },
    ],
  },
  {
    label: "Salesman",
    icon: Route,
    children: [
      { label: "Salesmen", href: "/salesman" },
      { label: "Recovery history", href: "/salesman/recoveries" },
      { label: "Sector sheets", href: "/salesman/routes" },
      { label: "Field dashboard", href: "/field" },
      { label: "Salesman performance", href: "/sales/salesmen" },
      { label: "Salesman ledger", href: "/reports/salesman-ledger" },
    ],
  },
  {
    label: "Purchases",
    icon: Truck,
    children: [
      { label: "Purchase invoice", href: "/purchases/invoices" },
      { label: "Gate pass", href: "/purchases/gate-passes" },
      { label: "Purchase return", href: "/purchases/returns" },
      { label: "Expiry warehouse", href: "/inventory/expiry?tab=claims" },
    ],
  },
  {
    label: "Vouchers",
    icon: Wallet,
    children: [
      { label: "Cash receipt", href: "/vouchers/cash-receipt" },
      { label: "Recovery history", href: "/salesman/recoveries" },
      { label: "Cash payment", href: "/vouchers/cash-payment" },
      { label: "Cash management", href: "/vouchers/cash-management" },
      { label: "Daily expenses & salary", href: "/vouchers/expenses" },
      { label: "Journal voucher", href: "/vouchers/journal" },
    ],
  },
  {
    label: "Reports",
    icon: FileBarChart2,
    children: [
      { label: "Sales", href: "/reports/sales" },
      { label: "Purchases", href: "/reports/purchases" },
      { label: "Stock", href: "/reports/stock" },
      { label: "Company statement", href: "/reports/company" },
      { label: "Expiry warehouse", href: "/reports/expiry" },
      { label: "Profit summary", href: "/reports/profit" },
      { label: "Expense report", href: "/reports/expenses" },
      { label: "Customer balances", href: "/reports/accounts?view=receivable" },
      { label: "Customer ledger", href: "/reports/accounts?view=ledger" },
      { label: "Customer receivables", href: "/reports/recovery" },
      { label: "Aging report", href: "/reports/aging" },
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

/** Screens a salesman may open. Office pages stay off this list. */
export function salesmanNavFor(permissions: readonly string[]): NavItem[] {
  const items: NavItem[] = [
    { label: "Dashboard", href: "/field", icon: LayoutDashboard },
    { label: "My shops", href: "/field/shops", icon: Users },
    { label: "Take order", href: "/field/order", icon: ShoppingCart },
  ];
  if (permissions.includes("create_invoices")) {
    items.push({ label: "Quick sale", href: "/field/sale", icon: ShoppingCart });
  }
  if (permissions.includes("create_vouchers")) {
    items.push({ label: "Collect", href: "/field/recovery", icon: Wallet });
  }
  if (permissions.includes("edit_customers")) {
    items.push({
      label: "Customers",
      href: "/field/customers",
      icon: Users,
    });
  }
  if (permissions.includes("edit_products")) {
    items.push({ label: "Products", href: "/field/products", icon: Package });
  }
  if (permissions.includes("create_purchases")) {
    items.push({
      label: "Purchases",
      href: "/field/purchases",
      icon: Truck,
    });
  }
  if (permissions.includes("view_reports")) {
    items.push({
      label: "Reports",
      href: "/field/reports",
      icon: FileBarChart2,
    });
  }
  items.push(
    { label: "Sync", href: "/settings/sync", icon: Settings },
    { label: "My account", href: "/field/account", icon: Settings },
  );
  return items;
}

export function salesmanCanOpen(path: string, permissions: readonly string[]) {
  if (path.startsWith("/field/sale") && !permissions.includes("create_invoices")) {
    return false;
  }
  if (path.startsWith("/field/recovery") && !permissions.includes("create_vouchers")) {
    return false;
  }
  if (path.startsWith("/field/customers") && !permissions.includes("edit_customers")) {
    return false;
  }
  if (path.startsWith("/field/products") && !permissions.includes("edit_products")) {
    return false;
  }
  if (path.startsWith("/field/purchases") && !permissions.includes("create_purchases")) {
    return false;
  }
  if (path.startsWith("/field/reports") && !permissions.includes("view_reports")) {
    return false;
  }
  if (path === "/field" || path.startsWith("/field/")) return true;
  if (path === "/select-company" || path.startsWith("/select-company/")) return true;
  if (path === "/settings/sync" || path.startsWith("/settings/sync/")) return true;
  if (
    (path === "/parties" || path.startsWith("/parties/")) &&
    permissions.includes("edit_customers")
  ) {
    return true;
  }
  if (
    (path === "/products" || path.startsWith("/products/")) &&
    permissions.includes("edit_products")
  ) {
    return true;
  }
  if (path.startsWith("/purchases") && permissions.includes("create_purchases")) {
    return true;
  }
  if (path.startsWith("/reports") && permissions.includes("view_reports")) {
    return true;
  }
  return false;
}

export const adminNav: NavItem[] = [
  {
    label: "Platform home",
    href: "/super-admin",
    icon: Shield,
  },
  {
    label: "New client",
    href: "/super-admin/provision",
    icon: Building2,
  },
  {
    label: "Clients",
    href: "/super-admin/clients",
    icon: Users,
  },
  {
    label: "Organizations",
    href: "/super-admin/organizations",
    icon: Building2,
  },
  {
    label: "Companies",
    href: "/super-admin/companies",
    icon: Boxes,
  },
];

/** Super-admin links grouped under one sidebar dropdown (ERP shell only). */
export const platformNav: NavItem = {
  label: "Platform",
  icon: Shield,
  children: adminNav.map(({ label, href }) => ({ label, href: href! })),
};

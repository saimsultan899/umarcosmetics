import { ChartCard } from "@/components/analytics/chart-card";
import {
  CompareBarChart,
  DonutChart,
  RankBars,
  TrendAreaChart,
} from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { requireCompanyContext } from "@/lib/auth";
import { effectivePermissions, type PermissionKey } from "@/lib/access/permissions";
import { FieldHeader, FieldTile } from "@/components/field/field-frame";
import { formatCompactPkr } from "@/lib/utils";
import {
  BarChart3,
  Cloud,
  ClipboardList,
  Package,
  ShoppingCart,
  Store,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

function lastDays(count: number) {
  const out: string[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - i);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    out.push(`${date.getFullYear()}-${month}-${day}`);
  }
  return out;
}

const actions: Array<{
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  tone: string;
  permission?: PermissionKey;
}> = [
  {
    href: "/field/order",
    label: "Take order",
    hint: "Send a shop order to the office",
    icon: ClipboardList,
    tone: "bg-sky-50 text-sky-700",
  },
  {
    href: "/field/shops",
    label: "My shops",
    hint: "Balances and contacts",
    icon: Store,
    tone: "bg-amber-50 text-amber-700",
  },
  {
    href: "/field/sale",
    label: "Quick sale",
    hint: "Post a credit sale now",
    icon: ShoppingCart,
    tone: "bg-[var(--brand-soft)] text-[var(--brand)]",
    permission: "create_invoices",
  },
  {
    href: "/field/recovery",
    label: "Collect",
    hint: "Post cash from shops",
    icon: Wallet,
    tone: "bg-emerald-50 text-emerald-700",
    permission: "create_vouchers",
  },
  {
    href: "/field/customers",
    label: "Customers",
    hint: "Edit the shops in your sectors",
    icon: Users,
    tone: "bg-violet-50 text-violet-700",
    permission: "edit_customers",
  },
  {
    href: "/field/products",
    label: "Products",
    hint: "Trade price, stock, and product edits",
    icon: Package,
    tone: "bg-orange-50 text-orange-700",
    permission: "edit_products",
  },
  {
    href: "/field/purchases",
    label: "Purchases",
    hint: "Recent bills and a new purchase",
    icon: Truck,
    tone: "bg-slate-100 text-slate-700",
    permission: "create_purchases",
  },
  {
    href: "/field/reports",
    label: "Reports",
    hint: "Sales, recovery, your ledger, and stock",
    icon: BarChart3,
    tone: "bg-indigo-50 text-indigo-700",
    permission: "view_reports",
  },
  {
    href: "/settings/sync",
    label: "Sync",
    hint: "Send anything waiting on this phone",
    icon: Cloud,
    tone: "bg-[var(--surface-2)] text-[var(--muted)]",
  },
];

export default async function FieldHomePage() {
  const { supabase, company, user, membership, offline } = await requireCompanyContext();
  const permissions = effectivePermissions(membership);
  const canSell = permissions.includes("create_invoices");
  const canCollect = permissions.includes("create_vouchers");
  const visibleActions = actions.filter(
    (item) => !item.permission || permissions.includes(item.permission),
  );
  if (offline) {
    const { OfflineFieldHomePage } = await import(
      "@/components/offline/offline-field-pages"
    );
    return (
      <OfflineFieldHomePage
        companyId={company.id}
        companyName={company.name}
      />
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  const days = lastDays(7);
  const from = days[0];

  const [{ data: shops }, { data: recoveries }, { data: sales }, { data: openOrders }] =
    await Promise.all([
      supabase.rpc("get_salesman_shops", {
        p_company_id: company.id,
        p_as_of: today,
      }),
      supabase
        .from("recoveries")
        .select("amount, recovery_date")
        .eq("company_id", company.id)
        .eq("created_by", user.id)
        .gte("recovery_date", from)
        .lte("recovery_date", today),
      supabase
        .from("sale_invoices")
        .select("grand_total, invoice_date")
        .eq("company_id", company.id)
        .eq("created_by", user.id)
        .eq("status", "posted")
        .gte("invoice_date", from)
        .lte("invoice_date", today),
      supabase
        .from("sale_orders")
        .select("id, sale_order_lines(amount)")
        .eq("company_id", company.id)
        .eq("created_by", user.id)
        .eq("status", "open")
        .limit(40),
    ]);

  const recoveryTotal = (recoveries || [])
    .filter((row) => row.recovery_date === today)
    .reduce((s, r) => s + Number(r.amount || 0), 0);
  const salesTotal = (sales || [])
    .filter((row) => row.invoice_date === today)
    .reduce((s, r) => s + Number(r.grand_total || 0), 0);
  const week = days.map((day) => ({
    name: day.slice(8) + "/" + day.slice(5, 7),
    value: (sales || [])
      .filter((row) => row.invoice_date === day)
      .reduce((sum, row) => sum + Number(row.grand_total || 0), 0),
    secondary: (recoveries || [])
      .filter((row) => row.recovery_date === day)
      .reduce((sum, row) => sum + Number(row.amount || 0), 0),
  }));
  const weekSales = week.reduce((sum, row) => sum + row.value, 0);
  const weekCollected = week.reduce((sum, row) => sum + Number(row.secondary || 0), 0);
  const openOrderRows = (openOrders || []) as Array<{
    sale_order_lines: Array<{ amount: number | string }> | null;
  }>;
  const openOrderAmount = openOrderRows.reduce(
    (sum, order) =>
      sum +
      (order.sale_order_lines || []).reduce(
        (lineSum, line) => lineSum + Number(line.amount || 0),
        0,
      ),
    0,
  );
  const shopList = (shops || []) as Array<{
    party_id: string;
    party_code: string;
    name_en: string;
    route: string | null;
    balance: number;
  }>;
  const dueShops = shopList.filter((s) => Number(s.balance) > 0);
  const dueTotal = dueShops.reduce((s, r) => s + Number(r.balance || 0), 0);
  const topDue = dueShops
    .slice()
    .sort((a, b) => Number(b.balance) - Number(a.balance))
    .slice(0, 6)
    .map((s) => ({
      name: `${s.party_code} ${s.name_en}`,
      value: Number(s.balance),
    }));
  const sectorMap = new Map<string, number>();
  for (const shop of dueShops) {
    const name = shop.route || "No sector";
    sectorMap.set(name, (sectorMap.get(name) || 0) + Number(shop.balance || 0));
  }
  const sectorMix = [...sectorMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="animate-rise space-y-6">
      <FieldHeader
        title={greeting}
        description={`${company.name} · your shops, orders, and the last 7 days`}
      />

      <StatsGrid className="grid-cols-2 lg:grid-cols-4">
        {canCollect ? (
          <StatCard
            label="Today recovery"
            value={recoveryTotal}
            format="money"
            icon={Wallet}
            tone="ok"
            href="/field/recovery"
            hint={`7 days ${formatCompactPkr(weekCollected)}`}
          />
        ) : null}
        {canSell ? (
          <StatCard
            label="Today sales"
            value={salesTotal}
            format="money"
            icon={ShoppingCart}
            href="/field/sale"
            hint={`7 days ${formatCompactPkr(weekSales)}`}
          />
        ) : null}
        <StatCard
          label="Open orders"
          value={openOrderRows.length}
          format="number"
          icon={ClipboardList}
          tone="neutral"
          href="/field/order"
          hint={formatCompactPkr(openOrderAmount)}
        />
        <StatCard
          label="My shops"
          value={shopList.length}
          format="number"
          icon={Store}
          tone="neutral"
          href="/field/shops"
          hint="Shops in your sectors"
        />
        <StatCard
          label="Still due"
          value={dueTotal}
          format="money"
          icon={Wallet}
          tone="warn"
          href="/field/shops"
          hint={`${dueShops.length} shops left to collect`}
        />
      </StatsGrid>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Last 7 days"
          subtitle="Your posted sales and collections"
        >
          {canSell && canCollect ? (
            <CompareBarChart
              data={week}
              valueLabel="Sales"
              secondaryLabel="Collected"
              height={260}
            />
          ) : (
            <TrendAreaChart
              data={week.map((row) => ({
                name: row.name,
                value: canCollect ? Number(row.secondary || 0) : row.value,
              }))}
              valueLabel={canCollect && !canSell ? "Collected" : "Sales"}
              tone={canCollect && !canSell ? "ok" : "brand"}
              height={260}
            />
          )}
        </ChartCard>
        <ChartCard title="Due by sector" subtitle="Outstanding in your shops">
          <DonutChart
            data={sectorMix}
            centerLabel="Due"
            centerValue={formatCompactPkr(dueTotal)}
            height={260}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <ChartCard
          className="lg:col-span-3"
          title="Shops to visit"
          subtitle="Highest balances first"
        >
          {topDue.length ? (
            <RankBars data={topDue} />
          ) : (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              No outstanding dues in your sectors.
            </p>
          )}
        </ChartCard>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-1">
          {visibleActions.map((item) => (
            <FieldTile key={item.href} {...item} />
          ))}
        </div>
      </div>
    </div>
  );
}

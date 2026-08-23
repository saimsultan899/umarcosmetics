import { ChartCard } from "@/components/analytics/chart-card";
import { RankBars } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { requireCompanyContext } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  Cloud,
  ShoppingCart,
  Store,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

const actions: Array<{
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  tone: string;
}> = [
  {
    href: "/field/recovery",
    label: "Collect recovery",
    hint: "Post cash from shops",
    icon: Wallet,
    tone: "bg-emerald-50 text-emerald-700",
  },
  {
    href: "/field/sale",
    label: "Quick credit sale",
    hint: "Sell in the sector",
    icon: ShoppingCart,
    tone: "bg-[var(--brand-soft)] text-[var(--brand)]",
  },
  {
    href: "/field/shops",
    label: "Browse sector shops",
    hint: "Balances & contacts",
    icon: Store,
    tone: "bg-amber-50 text-amber-700",
  },
  {
    href: "/settings/sync",
    label: "Sync pending",
    hint: "Night close / upload",
    icon: Cloud,
    tone: "bg-[var(--surface-2)] text-[var(--muted)]",
  },
];

export default async function FieldHomePage() {
  const { supabase, company, user } = await requireCompanyContext();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: shops }, { data: recoveries }, { data: sales }] =
    await Promise.all([
      supabase.rpc("get_salesman_shops", {
        p_company_id: company.id,
        p_as_of: today,
      }),
      supabase
        .from("recoveries")
        .select("amount")
        .eq("company_id", company.id)
        .eq("recovery_date", today)
        .eq("created_by", user.id),
      supabase
        .from("sale_invoices")
        .select("grand_total")
        .eq("company_id", company.id)
        .eq("invoice_date", today)
        .eq("created_by", user.id),
    ]);

  const recoveryTotal = (recoveries || []).reduce(
    (s, r) => s + Number(r.amount || 0),
    0,
  );
  const salesTotal = (sales || []).reduce(
    (s, r) => s + Number(r.grand_total || 0),
    0,
  );
  const shopList = (shops || []) as Array<{
    party_id: string;
    party_code: string;
    name_en: string;
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

  return (
    <div className="animate-rise space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">
            Field app
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold">
            Market dashboard
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{company.name}</p>
        </div>
        <div className="hidden gap-2 sm:flex">
          <Link
            href="/field/recovery"
            className="inline-flex h-9 items-center rounded-lg bg-[var(--brand)] px-3 text-sm font-medium text-white"
          >
            Collect
          </Link>
          <Link
            href="/field/sale"
            className="inline-flex h-9 items-center rounded-lg border border-[var(--border)] bg-white px-3 text-sm font-medium"
          >
            New sale
          </Link>
        </div>
      </div>

      <StatsGrid className="grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Today recovery"
          value={recoveryTotal}
          format="money"
          icon={Wallet}
          tone="ok"
          hint="Cash you collected today"
        />
        <StatCard
          label="Today sales"
          value={salesTotal}
          format="money"
          icon={ShoppingCart}
          hint="Field sales posted today"
        />
        <StatCard
          label="Assigned shops"
          value={shopList.length}
          format="number"
          icon={Store}
          tone="neutral"
          href="/field/shops"
          hint="Your sector coverage"
        />
        <StatCard
          label="Still due"
          value={dueTotal}
          format="money"
          icon={Wallet}
          tone="warn"
          hint={`${dueShops.length} shops left to collect`}
        />
      </StatsGrid>

      <div className="grid gap-4 lg:grid-cols-5">
        <ChartCard
          className="lg:col-span-3"
          title="Top dues in your sector"
          subtitle="Visit these shops first"
        >
          {topDue.length ? (
            <RankBars data={topDue} />
          ) : (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              No outstanding dues in your sector today.
            </p>
          )}
        </ChartCard>

        <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-1">
          {actions.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-white px-4 py-3.5 shadow-sm transition hover:border-[var(--brand)] hover:shadow-md"
              >
                <span
                  className={cn(
                    "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                    item.tone,
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--ink)]">
                    {item.label}
                  </span>
                  <span className="block text-xs text-[var(--muted)]">
                    {item.hint}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

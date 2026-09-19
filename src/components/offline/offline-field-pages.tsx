"use client";

import { ChartCard } from "@/components/analytics/chart-card";
import { RankBars } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { FieldRecoveryForm } from "@/components/field/field-recovery-form";
import { FieldSaleForm } from "@/components/field/field-sale-form";
import { SectorSheetTable, type SectorSheetRow } from "@/components/reports/sector-sheet-table";
import { OfflineBanner } from "@/components/offline/offline-banner";
import { PrintButton } from "@/components/ui/print-button";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { useOfflineData } from "@/hooks/use-offline-data";
import { offlineAccountsBalances } from "@/lib/offline/offline-reports";
import {
  hasLocalSqlite,
  localListMaster,
} from "@/lib/offline/sqlite-client";
import type { Party, Product, Warehouse } from "@/lib/types/database";
import { cn, formatPkr } from "@/lib/utils";
import {
  Cloud,
  ShoppingCart,
  Store,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

function asParty(row: Record<string, unknown>): Party {
  return row as unknown as Party;
}

function asProduct(row: Record<string, unknown>): Product {
  return row as unknown as Product;
}

function asWarehouse(row: Record<string, unknown>): Warehouse {
  return row as unknown as Warehouse;
}

function isCustomer(p: Party) {
  return (
    p.party_subtype === "customer" ||
    p.party_subtype === "both" ||
    p.party_type === "PARTY"
  );
}

const FIELD_ACTIONS: Array<{
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

/** Field Market Dashboard (offline) */
export function OfflineFieldHomePage({
  companyId,
  companyName = "Company",
}: {
  companyId: string;
  companyName?: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: sales, loading: salesLoading } = useOfflineData("sale_invoices", companyId);
  const { data: vouchers, loading: vouchersLoading } = useOfflineData("vouchers", companyId);
  const [balances, setBalances] = useState<
    Array<{ party_id: string; party_code: string; name_en: string; city: string | null; route: string | null; balance: number; credit_limit: number }>
  >([]);
  const [balLoading, setBalLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void offlineAccountsBalances(companyId).then((rows) => {
      if (!cancelled) {
        setBalances(rows);
        setBalLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const todaySalesTotal = useMemo(() => {
    return sales
      .filter((s) => String(s.invoice_date || s.doc_date || "").slice(0, 10) === today)
      .reduce((sum, s) => sum + Number(s.grand_total || s.amount || 0), 0);
  }, [sales, today]);

  const todayRecoveryTotal = useMemo(() => {
    return vouchers
      .filter((v) => {
        const d = String(v.recovery_date || v.voucher_date || v.doc_date || "").slice(0, 10);
        const t = String(v.voucher_type || v.type || "");
        return d === today && (t === "recovery" || t === "cash_receipt" || t === "CR" || !t);
      })
      .reduce((sum, v) => sum + Number(v.amount || v.total_amount || v.grand_total || 0), 0);
  }, [vouchers, today]);

  const dueShops = useMemo(() => balances.filter((b) => b.balance > 0.005), [balances]);
  const dueTotal = useMemo(() => dueShops.reduce((sum, b) => sum + b.balance, 0), [dueShops]);

  const topDue = useMemo(() => {
    return dueShops
      .slice()
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 6)
      .map((s) => ({
        name: `${s.party_code} ${s.name_en}`,
        value: s.balance,
      }));
  }, [dueShops]);

  const loading = salesLoading || vouchersLoading || balLoading;

  if (loading) {
    return (
      <div className="animate-rise space-y-6">
        <OfflineBanner companyId={companyId} />
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div className="animate-rise space-y-6">
      <OfflineBanner companyId={companyId} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">
            Field app · Offline
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold">
            Market dashboard
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{companyName}</p>
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
          value={todayRecoveryTotal}
          format="money"
          icon={Wallet}
          tone="ok"
          hint="Cash collected today (local)"
        />
        <StatCard
          label="Today sales"
          value={todaySalesTotal}
          format="money"
          icon={ShoppingCart}
          hint="Field sales posted today (local)"
        />
        <StatCard
          label="Assigned shops"
          value={balances.length}
          format="number"
          icon={Store}
          tone="neutral"
          href="/field/shops"
          hint="Local sector coverage"
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
          {FIELD_ACTIONS.map((item) => {
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

/** Field Shops List (offline) */
export function OfflineFieldShopsPage({
  companyId,
  companyName = "Company",
}: {
  companyId: string;
  companyName?: string;
}) {
  const { data: parties, loading: partiesLoading } = useOfflineData<Party>("parties", companyId);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [balLoading, setBalLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void offlineAccountsBalances(companyId).then((rows) => {
      if (!cancelled) {
        const map: Record<string, number> = {};
        for (const r of rows) map[r.party_id] = r.balance;
        setBalances(map);
        setBalLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const shops = useMemo(() => {
    return parties.filter(isCustomer).map((p) => ({
      party_id: p.id,
      party_code: p.party_code,
      name_en: p.name_en,
      city: p.city || p.head || null,
      route: p.route || null,
      mobile: p.mobile || p.phone || null,
      balance: balances[p.id] ?? Number(p.opening_balance || 0),
    }));
  }, [parties, balances]);

  const loading = partiesLoading || balLoading;

  if (loading) {
    return (
      <div className="animate-rise space-y-5">
        <OfflineBanner companyId={companyId} />
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div className="animate-rise space-y-5">
      <OfflineBanner companyId={companyId} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold sm:text-3xl">
            My shops
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Sector / city assigned parties · {companyName} (offline)
          </p>
        </div>
        <p className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-semibold text-[var(--muted)]">
          {shops.length} shops
        </p>
      </div>

      {shops.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shops.map((s) => (
            <div
              key={s.party_id}
              className="flex h-full flex-col rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {s.party_code} — {s.name_en}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {[s.city, s.route, s.mobile].filter(Boolean).join(" · ") ||
                      "—"}
                  </p>
                </div>
                <p
                  className={`shrink-0 text-sm font-semibold ${
                    Number(s.balance) > 0.005
                      ? "text-rose-700"
                      : Number(s.balance) < -0.005
                        ? "text-emerald-700"
                        : "text-[var(--muted)]"
                  }`}
                >
                  {Math.abs(Number(s.balance)) < 0.005
                    ? "Nil"
                    : `${formatPkr(Math.abs(Number(s.balance)))} ${
                        Number(s.balance) > 0 ? "Dr" : "Cr"
                      }`}
                </p>
              </div>
              <div className="mt-auto flex gap-2 pt-4">
                <Link
                  href={`/field/recovery?party=${s.party_id}`}
                  className="inline-flex flex-1 items-center justify-center rounded-lg bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white"
                >
                  Collect
                </Link>
                <Link
                  href={`/field/sale?party=${s.party_id}`}
                  className="inline-flex flex-1 items-center justify-center rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold"
                >
                  Sale
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--muted)]">
          No shops in local cache. Open Sync when online to download catalog and customer balances.
        </div>
      )}
    </div>
  );
}

/** Offline Sector Sheets Page */
export function OfflineSectorSheetsPage({
  companyId,
  companyName = "Company",
}: {
  companyId: string;
  companyName?: string;
}) {
  const [rows, setRows] = useState<SectorSheetRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void offlineAccountsBalances(companyId).then((data) => {
      if (!cancelled) {
        const filtered: SectorSheetRow[] = data
          .filter((r) => r.balance > 0.005)
          .map((r) => ({
            party_id: r.party_id,
            party_code: r.party_code,
            name_en: r.name_en,
            city: r.city || null,
            route: r.route || null,
            balance: r.balance,
          }));
        setRows(filtered);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  if (loading) {
    return (
      <div className="animate-rise space-y-6">
        <OfflineBanner companyId={companyId} />
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div className="animate-rise space-y-6">
      <OfflineBanner companyId={companyId} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Sector sheets
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Printable dues list for salesman market visits · {companyName} (offline)
          </p>
        </div>
        <PrintButton label="Print sector sheet" />
      </div>

      <SectorSheetTable rows={rows} companyName={companyName} />
    </div>
  );
}

/** Field quick-sale that loads masters from SQLite / IndexedDB cache. */
export function OfflineFieldSalePage({
  companyId,
  organizationId,
}: {
  companyId: string;
  organizationId: string;
}) {
  const partiesQ = useOfflineData<Party>("parties", companyId);
  const productsQ = useOfflineData<Product>("products", companyId);
  const warehousesQ = useOfflineData<Warehouse>("warehouses", companyId);
  const [sqliteParties, setSqliteParties] = useState<Party[] | null>(null);
  const [sqliteProducts, setSqliteProducts] = useState<Product[] | null>(null);
  const [sqliteWarehouses, setSqliteWarehouses] = useState<Warehouse[] | null>(
    null,
  );

  useEffect(() => {
    if (!hasLocalSqlite()) return;
    void (async () => {
      const [p, pr, w] = await Promise.all([
        localListMaster("parties", companyId, 5000),
        localListMaster("products", companyId, 5000),
        localListMaster("warehouses", companyId, 500),
      ]);
      if (p.ok && p.rows?.length) {
        setSqliteParties(p.rows.map(asParty));
      }
      if (pr.ok && pr.rows?.length) {
        setSqliteProducts(pr.rows.map(asProduct));
      }
      if (w.ok && w.rows?.length) {
        setSqliteWarehouses(w.rows.map(asWarehouse));
      }
    })();
  }, [companyId]);

  const parties = sqliteParties?.length ? sqliteParties : partiesQ.data;
  const products = sqliteProducts?.length ? sqliteProducts : productsQ.data;
  const warehouses = sqliteWarehouses?.length
    ? sqliteWarehouses
    : warehousesQ.data;

  const shops = useMemo(
    () =>
      parties.filter(isCustomer).map((p) => ({
        party_id: p.id,
        party_code: p.party_code,
        name_en: p.name_en,
        route: p.route,
        city: p.city,
      })),
    [parties],
  );

  const loading =
    (partiesQ.loading || productsQ.loading || warehousesQ.loading) &&
    !sqliteParties &&
    !sqliteProducts;

  if (loading) {
    return (
      <div className="animate-rise mx-auto w-full max-w-3xl space-y-5">
        <OfflineBanner companyId={companyId} />
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div className="animate-rise mx-auto w-full max-w-3xl space-y-5">
      <OfflineBanner companyId={companyId} />
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold sm:text-3xl">
          Quick sale
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Offline field sale — saved on this PC and synced when online
        </p>
      </div>
      <div className="panel p-4 sm:p-6">
        {shops.length === 0 || products.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No cached shops/products yet. Connect once and open Sync to refresh
            masters, then try again offline.
          </p>
        ) : (
          <FieldSaleForm
            companyId={companyId}
            organizationId={organizationId}
            shops={shops}
            products={products}
            warehouses={warehouses}
          />
        )}
      </div>
    </div>
  );
}

/** Field recovery that loads customer list from local cache. */
export function OfflineFieldRecoveryPage({
  companyId,
  organizationId,
}: {
  companyId: string;
  organizationId: string;
}) {
  const partiesQ = useOfflineData<Party>("parties", companyId);
  const [sqliteParties, setSqliteParties] = useState<Party[] | null>(null);

  useEffect(() => {
    if (!hasLocalSqlite()) return;
    void (async () => {
      const p = await localListMaster("parties", companyId, 5000);
      if (p.ok && p.rows?.length) setSqliteParties(p.rows.map(asParty));
    })();
  }, [companyId]);

  const parties = sqliteParties?.length ? sqliteParties : partiesQ.data;
  const shops = useMemo(
    () =>
      parties.filter(isCustomer).map((p) => ({
        party_id: p.id,
        party_code: p.party_code,
        name_en: p.name_en,
        balance: 0,
      })),
    [parties],
  );

  if (partiesQ.loading && !sqliteParties) {
    return (
      <div className="animate-rise mx-auto w-full max-w-3xl space-y-5">
        <OfflineBanner companyId={companyId} />
        <PageSkeleton />
      </div>
    );
  }

  return (
    <div className="animate-rise mx-auto w-full max-w-3xl space-y-5">
      <OfflineBanner companyId={companyId} />
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold sm:text-3xl">
          Collect recovery
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Works offline — syncs to main accounts when online
        </p>
      </div>
      <div className="panel p-4 sm:p-6">
        {shops.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No cached customers yet. Connect once and refresh caches, then try
            again offline.
          </p>
        ) : (
          <FieldRecoveryForm
            companyId={companyId}
            organizationId={organizationId}
            shops={shops}
          />
        )}
      </div>
    </div>
  );
}

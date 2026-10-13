"use client";

import { createClient } from "@/lib/supabase/client";
import { fetchCompanySalesmen, type SalesmanOption } from "@/lib/queries/salesmen";
import {
  withHubStockOverlay,
  type StockBalanceLite,
} from "@/lib/trading/hub-stock";
import type { Party, Product, Warehouse } from "@/lib/types/database";
import { useEffect, useState } from "react";

export type TradingCatalog = {
  parties: Party[];
  products: Product[];
  warehouses: Warehouse[];
  stockBalances: StockBalanceLite[];
  salesmen: SalesmanOption[];
  ready: boolean;
  error: string | null;
};

type StoredCatalog = {
  parties: Party[];
  products: Product[];
  warehouses: Warehouse[];
  stockBalances: StockBalanceLite[];
  salesmen: SalesmanOption[];
  stockLoaded: boolean;
  salesmenLoaded: boolean;
};

const memory = new Map<string, StoredCatalog>();
const inflight = new Map<string, Promise<StoredCatalog>>();
const baseInflight = new Map<string, Promise<StoredCatalog>>();

/** PostgREST returns at most 1,000 rows unless the query is paged. */
async function fetchAllPages<T>(
  make: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; from < 50000; from += pageSize) {
    const { data, error } = await make(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

const EMPTY: TradingCatalog = {
  parties: [],
  products: [],
  warehouses: [],
  stockBalances: [],
  salesmen: [],
  ready: false,
  error: null,
};

function toPublic(stored: StoredCatalog, error: string | null = null): TradingCatalog {
  return {
    parties: stored.parties,
    products: stored.products,
    warehouses: stored.warehouses,
    stockBalances: stored.stockBalances,
    salesmen: stored.salesmen,
    ready: true,
    error,
  };
}

async function fetchCatalog(
  companyId: string,
  opts: { stock: boolean; salesmen: boolean },
): Promise<StoredCatalog> {
  const base = baseInflight.get(companyId);
  if (base && !memory.get(companyId)) await base;

  const previous = memory.get(companyId);
  const supabase = createClient();
  const needBase = !previous;
  const needStock = opts.stock && !previous?.stockLoaded;
  const needSalesmen = opts.salesmen && !previous?.salesmenLoaded;

  const [parties, products, warehouses, stockPage, salesmen] = await Promise.all([
    needBase
      ? fetchAllPages<Party>((from, to) =>
          supabase
            .from("parties")
            .select("*")
            .eq("company_id", companyId)
            .eq("is_active", true)
            .order("sort_order", { ascending: true })
            .order("name_en")
            .range(from, to),
        )
      : Promise.resolve(previous!.parties),
    needBase
      ? fetchAllPages<Product>((from, to) =>
          supabase
            .from("products")
            .select("*")
            .eq("company_id", companyId)
            .eq("is_active", true)
            .order("code")
            .range(from, to),
        )
      : Promise.resolve(previous!.products),
    needBase
      ? fetchAllPages<Warehouse>((from, to) =>
          supabase
            .from("warehouses")
            .select("*")
            .eq("company_id", companyId)
            .eq("is_active", true)
            .order("name")
            .range(from, to),
        )
      : Promise.resolve(previous!.warehouses),
    needStock
      ? fetchAllPages<StockBalanceLite>((from, to) =>
          supabase
            .from("stock_balances")
            .select("product_id, warehouse_id, qty")
            .eq("company_id", companyId)
            .range(from, to),
        )
      : Promise.resolve(previous?.stockBalances || []),
    needSalesmen ? fetchCompanySalesmen(supabase, companyId) : Promise.resolve(null),
  ]);

  let stockBalances = stockPage;

  if (needStock) {
    stockBalances = await withHubStockOverlay(
      supabase,
      companyId,
      products,
      warehouses,
      stockBalances,
    );
  }

  const next: StoredCatalog = {
    parties,
    products,
    warehouses,
    stockBalances,
    salesmen: needSalesmen ? salesmen || [] : previous?.salesmen || [],
    stockLoaded: Boolean(previous?.stockLoaded || needStock),
    salesmenLoaded: Boolean(previous?.salesmenLoaded || needSalesmen),
  };
  memory.set(companyId, next);
  return next;
}

/** Session cache so opening a form, or the next page, does not download the catalog again. */
export function loadTradingCatalog(
  companyId: string,
  opts?: { stock?: boolean; salesmen?: boolean },
) {
  const stock = Boolean(opts?.stock);
  const salesmen = Boolean(opts?.salesmen);
  const cached = memory.get(companyId);
  if (
    cached &&
    (!stock || cached.stockLoaded) &&
    (!salesmen || cached.salesmenLoaded)
  ) {
    return Promise.resolve(cached);
  }

  const key = `${companyId}:${stock}:${salesmen}`;
  const pending = inflight.get(key);
  if (pending) return pending;

  const job = fetchCatalog(companyId, { stock, salesmen }).finally(() => {
    inflight.delete(key);
    if (baseInflight.get(companyId) === job) baseInflight.delete(companyId);
  });
  inflight.set(key, job);
  if (!memory.get(companyId)) baseInflight.set(companyId, job);
  return job;
}

export function useTradingCatalog(
  companyId: string,
  opts?: { enabled?: boolean; stock?: boolean; salesmen?: boolean },
) {
  const enabled = opts?.enabled !== false;
  const stock = Boolean(opts?.stock);
  const salesmen = Boolean(opts?.salesmen);
  const [catalog, setCatalog] = useState<TradingCatalog>(() => {
    const cached = memory.get(companyId);
    if (
      cached &&
      (!stock || cached.stockLoaded) &&
      (!salesmen || cached.salesmenLoaded)
    ) {
      return toPublic(cached);
    }
    return EMPTY;
  });

  useEffect(() => {
    if (!enabled || !companyId) return;
    let cancelled = false;
    const cached = memory.get(companyId);
    if (
      cached &&
      (!stock || cached.stockLoaded) &&
      (!salesmen || cached.salesmenLoaded)
    ) {
      setCatalog(toPublic(cached));
      return;
    }
    setCatalog((current) => ({ ...current, ready: false, error: null }));
    loadTradingCatalog(companyId, { stock, salesmen })
      .then((stored) => {
        if (!cancelled) setCatalog(toPublic(stored));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCatalog({
          ...EMPTY,
          ready: true,
          error: err instanceof Error ? err.message : "Could not load masters",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, enabled, stock, salesmen]);

  return catalog;
}

export function CatalogSlot({
  ready,
  error,
  children,
}: {
  ready: boolean;
  error?: string | null;
  children: React.ReactNode;
}) {
  if (!ready) {
    return (
      <p className="py-6 text-sm text-[var(--muted)]">
        Loading customers and products…
      </p>
    );
  }
  if (error) {
    return <p className="py-6 text-sm text-red-700">{error}</p>;
  }
  return children;
}

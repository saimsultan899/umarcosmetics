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

  const [partiesRes, productsRes, warehousesRes, stockRes, salesmen] =
    await Promise.all([
      needBase
        ? supabase
            .from("parties")
            .select("*")
            .eq("company_id", companyId)
            .eq("is_active", true)
            .order("name_en")
        : Promise.resolve(null),
      needBase
        ? supabase
            .from("products")
            .select("*")
            .eq("company_id", companyId)
            .eq("is_active", true)
            .order("code")
        : Promise.resolve(null),
      needBase
        ? supabase
            .from("warehouses")
            .select("*")
            .eq("company_id", companyId)
            .eq("is_active", true)
            .order("name")
        : Promise.resolve(null),
      needStock
        ? supabase
            .from("stock_balances")
            .select("product_id, warehouse_id, qty")
            .eq("company_id", companyId)
        : Promise.resolve(null),
      needSalesmen ? fetchCompanySalesmen(supabase, companyId) : Promise.resolve(null),
    ]);

  const partiesError = partiesRes && "error" in partiesRes ? partiesRes.error : null;
  const productsError = productsRes && "error" in productsRes ? productsRes.error : null;
  const warehousesError =
    warehousesRes && "error" in warehousesRes ? warehousesRes.error : null;
  const failed = partiesError || productsError || warehousesError;
  if (failed) throw new Error(failed.message);

  const products = needBase
    ? ((productsRes?.data || []) as Product[])
    : previous!.products;
  const warehouses = needBase
    ? ((warehousesRes?.data || []) as Warehouse[])
    : previous!.warehouses;
  let stockBalances = needStock
    ? ((stockRes?.data || []) as StockBalanceLite[])
    : previous?.stockBalances || [];

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
    parties: needBase
      ? ((partiesRes?.data || []) as Party[])
      : previous!.parties,
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

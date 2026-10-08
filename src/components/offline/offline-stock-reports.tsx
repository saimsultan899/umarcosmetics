"use client";

import { ChartCard } from "@/components/analytics/chart-card";
import { DonutChart, RankBars } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { ReportTable } from "@/components/reports/report-table";
import { StockReportFilters } from "@/components/reports/stock-report-filters";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { formatUomCompact } from "@/lib/pricing/uom";
import { formatCompactPkr, formatPkr} from "@/lib/utils";
import { getCachedRows } from "@/lib/offline/local-db";
import { offlineStockSnapshot } from "@/lib/offline/offline-reports";
import { AlertTriangle, Boxes, Package } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export function OfflineStockReportsPage({
  companyId,
  companyName,
  organizationId,
  canEditProduct = false,
  canInactivate = false,
  canDeleteProduct = false,
  searchParams: initialSp,
}: {
  companyId: string;
  companyName: string;
  organizationId?: string;
  canEditProduct?: boolean;
  canInactivate?: boolean;
  canDeleteProduct?: boolean;
  searchParams?: { view?: string };
}) {
  const urlSp = useSearchParams();

  const sp = useMemo(() => {
    return {
      view: urlSp.get("view") ?? initialSp?.view ?? "balances",
    };
  }, [urlSp, initialSp]);

  const view = sp.view || "balances";

  function productActions(productId: string) {
    if (
      !productId ||
      !organizationId ||
      (!canEditProduct && !canInactivate && !canDeleteProduct)
    ) {
      return {};
    }
    return {
      _product_manage: "1",
      _product_id: productId,
      _company_id: companyId,
      _organization_id: organizationId,
      _can_edit_product: canEditProduct ? "1" : "0",
      _can_inactivate_product: canInactivate ? "1" : "0",
      _can_delete_product: canDeleteProduct ? "1" : "0",
    };
  }

  function movementActions(move: Record<string, unknown>, productId: string) {
    const table = String(move.ref_table || "");
    const id = String(move.ref_id || "");
    const editable = new Set([
      "sale_invoices",
      "purchase_invoices",
      "sale_returns",
      "purchase_returns",
      "vouchers",
      "recoveries",
    ]);
    if (table && id && editable.has(table)) {
      const href =
        table === "sale_invoices"
          ? `/sales/invoices/${id}`
          : table === "purchase_invoices"
            ? `/purchases/invoices/${id}`
            : table === "sale_returns"
              ? `/sales/returns/${id}`
              : table === "purchase_returns"
                ? `/purchases/returns/${id}`
                : "";
      return {
        _doc_table: table,
        _doc_id: id,
        _doc_title: String(move.move_type || "Stock movement").replaceAll("_", " "),
        ...(href ? { _href: href } : {}),
      };
    }
    return productActions(productId);
  }

  const [loading, setLoading] = useState(true);
  const [stock, setStock] = useState<Record<string, unknown>[]>([]);
  const [products, setProducts] = useState<Record<string, unknown>[]>([]);
  const [warehouses, setWarehouses] = useState<Record<string, unknown>[]>([]);
  const [movements, setMovements] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      try {
        const {
          hasLocalSqlite,
          localListByEntity,
        } = await import("@/lib/offline/sqlite-client");

        let moves: Record<string, unknown>[] = [];
        if (hasLocalSqlite()) {
          const res = await localListByEntity(companyId, "stock_movement", 200);
          moves = res.rows || [];
        }

        const [stk, prods, whs] = await Promise.all([
          offlineStockSnapshot(companyId),
          getCachedRows("products", companyId),
          getCachedRows("warehouses", companyId),
        ]);

        if (cancelled) return;
        setStock(stk);
        setProducts(prods);
        setWarehouses(whs);
        setMovements(moves);
      } catch (err) {
        console.error("Failed to load local stock data:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const prodMap = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const p of products) {
      if (p.id) map.set(String(p.id), p);
    }
    return map;
  }, [products]);

  const whMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of warehouses) {
      if (w.id) map.set(String(w.id), String(w.name || "Company"));
    }
    return map;
  }, [warehouses]);

  const balanceRows = useMemo(() => {
    return stock.map((r) => {
      const pid = String(r.product_id || "");
      const prod = prodMap.get(pid);
      const wid = String(r.warehouse_id || "");
      const whName = whMap.get(wid) || "—";
      const qty = Number(r.qty || 0);
      const purchaseRate = Number(prod?.purchase_rate || prod?.purchase_price || 0);
      const retailRate = Number(prod?.retail_rate || 0);
      const packing = Number(prod?.packing || 1);
      const reorder = Number(prod?.reorder_level || 0);

      return {
        _warehouseId: wid,
        Company: whName,
        Code: prod?.code || "—",
        Product: prod?.name_en || "—",
        Qty: qty,
        Packing: formatUomCompact(qty, packing, {
          unitType: prod?.unit_type as string | undefined,
          baseUnit: prod?.base_unit as string | undefined,
        }),
        Reorder: reorder,
        "Purchase rate": purchaseRate,
        "Retail rate": retailRate,
        "Value (purchase)": Math.round(qty * purchaseRate),
        "Value (retail)": Math.round(qty * retailRate),
        Status: reorder > 0 && qty <= reorder ? "Low" : "OK",
        ...productActions(pid),
      };
    });
  }, [stock, prodMap, whMap, organizationId, canEditProduct, canInactivate, canDeleteProduct]);

  const companyFilter = urlSp.get("company") || "";
  const statusFilter = urlSp.get("status") || "";
  const stockFilter = urlSp.get("stock") || "";

  const filteredBalances = useMemo(() => {
    return balanceRows.filter((row) => {
      if (companyFilter && row._warehouseId !== companyFilter) return false;
      if (statusFilter && row.Status.toLowerCase() !== statusFilter) return false;
      if (stockFilter === "in" && Number(row.Qty) <= 0) return false;
      if (stockFilter === "zero" && Number(row.Qty) !== 0) return false;
      return true;
    });
  }, [balanceRows, companyFilter, statusFilter, stockFilter]);

  const lowStockRows = useMemo(() => {
    return products
      .map((p) => {
        const pid = String(p.id);
        const onHand = stock
          .filter((s) => String(s.product_id) === pid)
          .reduce((sum, s) => sum + Number(s.qty || 0), 0);
        const reorder = Number(p.reorder_level || 0);
        const whId = String(p.default_warehouse_id || "");
        return {
          Company: whMap.get(whId) || "—",
          Code: p.code,
          Product: p.name_en,
          "On hand": onHand,
          "Reorder level": reorder,
          Deficit: reorder > 0 && onHand < reorder ? reorder - onHand : 0,
          ...productActions(pid),
        };
      })
      .filter((r) => r.Deficit > 0)
      .sort((a, b) => b.Deficit - a.Deficit);
  }, [products, stock, whMap, organizationId, canEditProduct, canInactivate, canDeleteProduct]);

  const movementRows = useMemo(() => {
    return movements.map((m) => {
      const pid = String(m.product_id || "");
      const prod = prodMap.get(pid);
      const wid = String(m.warehouse_id || "");
      const whName = whMap.get(wid) || "—";
      return {
        Date: String(m.created_at || m.doc_date || "").slice(0, 10),
        Company: whName,
        Code: prod?.code || "—",
        Product: prod?.name_en || "—",
        Type: String(m.move_type || m.type || "movement").toUpperCase(),
        Qty: Number(m.qty || 0),
        ...movementActions(m, pid),
      };
    });
  }, [movements, prodMap, whMap, organizationId, canEditProduct, canInactivate, canDeleteProduct]);

  const totalProducts = useMemo(() => {
    return filteredBalances.filter((r) => Number(r.Qty) > 0).length;
  }, [filteredBalances]);

  const totalUnits = useMemo(() => {
    return filteredBalances.reduce((s, r) => s + Number(r.Qty || 0), 0);
  }, [filteredBalances]);

  const totalPurchaseValue = useMemo(() => {
    return filteredBalances.reduce((s, r) => s + Number(r["Value (purchase)"] || 0), 0);
  }, [filteredBalances]);

  const totalRetailValue = useMemo(() => {
    return filteredBalances.reduce((s, r) => s + Number(r["Value (retail)"] || 0), 0);
  }, [filteredBalances]);

  const topProducts = useMemo(() => {
    return filteredBalances
      .filter((r) => Number(r.Qty) > 0)
      .sort((a, b) => Number(b.Qty) - Number(a.Qty))
      .slice(0, 6)
      .map((r) => ({
        name: String(r.Product),
        value: Number(r.Qty),
      }));
  }, [filteredBalances]);

  const valueByCompany = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filteredBalances) {
      const c = String(r.Company || "Unassigned");
      map.set(c, (map.get(c) || 0) + Number(r["Value (purchase)"] || 0));
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));
  }, [filteredBalances]);

  if (loading) {
    return (
      <div className="animate-rise space-y-6">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Stock Reports
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Multi-company inventory balances, movements, and reorder alerts
          </p>
        </div>
        <PageSkeleton />
      </div>
    );
  }

  const stockFilters = (
    <StockReportFilters
      companies={warehouses
        .filter((w) => w.id)
        .map((w) => ({ id: String(w.id), name: String(w.name || "Company") }))}
    />
  );

  return (
    <div className="animate-rise space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          Stock Reports
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Multi-company inventory balances, movements, and reorder alerts
        </p>
      </div>

      <div className="no-print flex flex-wrap gap-2">
        {[
          ["balances", "Current balances"],
          ["ledger", "Recent movements"],
          ["low_stock", "Low stock alerts"],
          ["reorder", "Reorder checklist"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={`/reports/stock?view=${key}`}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              view === key
                ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                : "border-[var(--border)] bg-white text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <StatsGrid>
        <StatCard
          label="Total SKUs in stock"
          value={totalProducts}
          format="number"
          icon={Package}
          tone="brand"
          hint="With positive inventory"
        />
        <StatCard
          label="Total units on hand"
          value={totalUnits}
          format="number"
          icon={Boxes}
          hint={`Purchase ${formatPkr(totalPurchaseValue)} · Retail ${formatPkr(totalRetailValue)}`}
        />
        <StatCard
          label="Low stock alerts"
          value={lowStockRows.length}
          format="number"
          icon={AlertTriangle}
          tone={lowStockRows.length ? "warn" : "ok"}
          hint="Items below reorder level"
        />
      </StatsGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Stock valuation by company" subtitle="Current inventory cost">
          <DonutChart
            data={valueByCompany}
            centerLabel="Purchase"
            centerValue={formatCompactPkr(totalPurchaseValue)}
          />
        </ChartCard>
        <ChartCard
          className="lg:col-span-2"
          title="Top products by quantity"
          subtitle="Highest inventory count"
        >
          <RankBars data={topProducts} />
        </ChartCard>
      </div>

      {view === "balances" ? (
        <ReportTable
          title="Current stock balances"
          companyName={companyName}
          subtitle={`${balanceRows.length} stock balance records · Total units ${totalUnits.toLocaleString()}`}
          rows={filteredBalances}
          filename="stock-balances"
          filters={stockFilters}
        />
      ) : view === "ledger" ? (
        <ReportTable
          title="Stock movement ledger"
          companyName={companyName}
          subtitle={`${movementRows.length} recent movement entries`}
          rows={movementRows}
          filename="stock-movements"
          filters={stockFilters}
        />
      ) : view === "low_stock" ? (
        <ReportTable
          title="Low stock alerts"
          companyName={companyName}
          subtitle={`${lowStockRows.length} items below minimum safety threshold`}
          rows={lowStockRows}
          filename="stock-low"
          filters={stockFilters}
        />
      ) : (
        <ReportTable
          title="Reorder checklist"
          companyName={companyName}
          subtitle="Products requiring immediate vendor replenishment"
          rows={lowStockRows}
          filename="stock-reorder"
          filters={stockFilters}
        />
      )}
    </div>
  );
}

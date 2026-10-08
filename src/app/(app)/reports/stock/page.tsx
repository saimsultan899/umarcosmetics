import { ChartCard } from "@/components/analytics/chart-card";
import { DonutChart, RankBars } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { ReportTable } from "@/components/reports/report-table";
import { StockReportFilters } from "@/components/reports/stock-report-filters";
import { requireCompanyContext } from "@/lib/auth";
import { effectivePermissions } from "@/lib/access/permissions";
import { formatUomCompact } from "@/lib/pricing/uom";
import { AlertTriangle, Boxes, Package } from "lucide-react";
import Link from "next/link";

export default async function StockReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    company?: string;
    status?: string;
    stock?: string;
  }>;
}) {
  const sp = await searchParams;
  const view = sp.view || "balances";
  const companyFilter = sp.company || "";
  const statusFilter = sp.status === "low" || sp.status === "ok" ? sp.status : "";
  const stockFilter = sp.stock === "in" || sp.stock === "zero" ? sp.stock : "";
  const ctx = await requireCompanyContext();
  const { company, offline, membership, profile } = ctx;
  const permissions = effectivePermissions(
    membership,
    Boolean(profile?.is_super_admin),
  );
  const canEditProduct = permissions.includes("edit_products");
  const canInactivate = permissions.includes("inactivate_records");
  const canDeleteProduct =
    membership?.role === "org_admin" || Boolean(profile?.is_super_admin);

  function movementActions(
    move: { ref_table?: string | null; ref_id?: string | null; move_type?: string | null },
    productId: string,
  ) {
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

  function productActions(productId: string) {
    if (!productId || (!canEditProduct && !canInactivate && !canDeleteProduct)) {
      return {};
    }
    return {
      _product_manage: "1",
      _product_id: productId,
      _company_id: company.id,
      _organization_id: company.organization_id,
      _can_edit_product: canEditProduct ? "1" : "0",
      _can_inactivate_product: canInactivate ? "1" : "0",
      _can_delete_product: canDeleteProduct ? "1" : "0",
    };
  }

  if (offline) {
    const { OfflineStockReportsPage } = await import(
      "@/components/offline/offline-stock-reports"
    );
    return (
      <OfflineStockReportsPage
        companyId={company.id}
        companyName={company.name}
        organizationId={company.organization_id}
        canEditProduct={canEditProduct}
        canInactivate={canInactivate}
        canDeleteProduct={canDeleteProduct}
        searchParams={sp}
      />
    );
  }

  const { supabase } = ctx;

  const [{ data: rows }, { data: movements }, { data: products }, { data: warehouses }] =
    await Promise.all([
      supabase
        .from("stock_balances")
        .select("qty, warehouse_id, product_id, products(id, code, name_en, reorder_level, purchase_rate, retail_rate, packing, unit_type, base_unit), warehouses(id, name)")
        .eq("company_id", company.id)
        .order("qty", { ascending: false })
        .limit(1000),
      supabase
        .from("stock_movements")
        .select("created_at, move_type, qty, warehouse_id, product_id, ref_table, ref_id, products(id, code, name_en, packing, unit_type, base_unit), warehouses(id, name)")
        .eq("company_id", company.id)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("products")
        .select("id, code, name_en, default_warehouse_id, reorder_level, opening_qty, purchase_rate, retail_rate, packing, unit_type, base_unit")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("code")
        .limit(1000),
      supabase
        .from("warehouses")
        .select("id, name")
        .eq("company_id", company.id),
    ]);

  const companyByWarehouse = new Map(
    (warehouses || []).map((w) => [w.id, w.name]),
  );

  const balanceRows = (rows || []).map((r) => {
    const product = Array.isArray(r.products) ? r.products[0] : r.products;
    const warehouse = Array.isArray(r.warehouses) ? r.warehouses[0] : r.warehouses;
    const qty = Number(r.qty);
    const purchaseRate = Number(product?.purchase_rate || 0);
    const retailRate = Number(product?.retail_rate || 0);
    const packing = Number(product?.packing || 1);
    const reorder = Number(product?.reorder_level || 0);
    return {
      _warehouseId: String(r.warehouse_id || warehouse?.id || ""),
      Company: warehouse?.name || "—",
      Code: product?.code || "—",
      Product: product?.name_en || "—",
      Qty: qty,
      Packing: formatUomCompact(qty, packing, {
        unitType: product?.unit_type,
        baseUnit: product?.base_unit,
      }),
      Reorder: reorder,
      "Purchase rate": purchaseRate,
      "Retail rate": retailRate,
      "Value (purchase)": qty * purchaseRate,
      "Value (retail)": qty * retailRate,
      Status: reorder > 0 && qty <= reorder ? "Low" : "OK",
      ...productActions(String(product?.id || r.product_id || "")),
    };
  });

  const analysisRows = (products || []).map((p) => ({
    _warehouseId: String(p.default_warehouse_id || ""),
    Company: companyByWarehouse.get(p.default_warehouse_id) || "—",
    Code: p.code,
    Product: p.name_en,
    "Opening qty": Number(p.opening_qty || 0),
    Packing: formatUomCompact(p.opening_qty, p.packing, {
      unitType: p.unit_type,
      baseUnit: p.base_unit,
    }),
    "Per pack": Number(p.packing || 1),
    Reorder: Number(p.reorder_level || 0),
    "Purchase rate": Number(p.purchase_rate || 0),
    "Retail rate": Number(p.retail_rate || 0),
    ...productActions(String(p.id || "")),
  }));

  const movementRows = (movements || []).map((m) => {
    const product = Array.isArray(m.products) ? m.products[0] : m.products;
    const warehouse = Array.isArray(m.warehouses) ? m.warehouses[0] : m.warehouses;
    const qty = Number(m.qty);
    return {
      _warehouseId: String(m.warehouse_id || warehouse?.id || ""),
      When: new Date(m.created_at).toLocaleString(),
      Type: String(m.move_type).replaceAll("_", " "),
      Company: warehouse?.name || "—",
      Code: product?.code || "—",
      Product: product?.name_en || "—",
      Qty: qty,
      Packing: formatUomCompact(Math.abs(qty), product?.packing, {
        unitType: product?.unit_type,
        baseUnit: product?.base_unit,
      }),
      ...movementActions(m, String(product?.id || m.product_id || "")),
    };
  });

  function matchesCompany(row: { _warehouseId?: string }) {
    return !companyFilter || row._warehouseId === companyFilter;
  }

  function matchesStockList(row: {
    _warehouseId?: string;
    Qty?: number;
    Status?: string;
  }) {
    if (!matchesCompany(row)) return false;
    if (statusFilter && row.Status?.toLowerCase() !== statusFilter) return false;
    if (stockFilter === "in" && Number(row.Qty || 0) <= 0) return false;
    if (stockFilter === "zero" && Number(row.Qty || 0) !== 0) return false;
    return true;
  }

  const filteredBalances = balanceRows.filter((row) => matchesStockList(row));

  const activeRows = (
    view === "analysis"
      ? analysisRows.filter((row) => matchesCompany(row))
      : view === "movements"
        ? movementRows.filter((row) => matchesCompany(row))
        : filteredBalances
  );

  function reportHref(nextView: string) {
    const params = new URLSearchParams();
    params.set("view", nextView);
    if (companyFilter) params.set("company", companyFilter);
    if (statusFilter) params.set("status", statusFilter);
    if (stockFilter) params.set("stock", stockFilter);
    return `/reports/stock?${params.toString()}`;
  }

  const title =
    view === "analysis"
      ? "Stock analysis"
      : view === "movements"
        ? "Item movements"
        : "Stock list";

  return (
    <div className="animate-rise space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          Stock Reports
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Balances, analysis, and movement history — {company.name}
        </p>
      </div>

      <div className="no-print flex flex-wrap gap-2">
        {[
          ["balances", "Stock list"],
          ["analysis", "Stock analysis"],
          ["movements", "Item movements"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={reportHref(key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              view === key
                ? "bg-[var(--brand)] !text-white"
                : "border border-[var(--border)] bg-white text-[var(--muted)]"
            }`}
          >
            {label}
          </Link>
        ))}
        <Link
          href="/reports/expiry"
          className="rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium text-[var(--muted)]"
        >
          Expiry warehouse
        </Link>
      </div>

      {(() => {
        const low = filteredBalances.filter((r) => r.Status === "Low").length;
        const purchaseValue = filteredBalances.reduce(
          (s, r) => s + Number(r["Value (purchase)"] || 0),
          0,
        );
        const retailValue = filteredBalances.reduce(
          (s, r) => s + Number(r["Value (retail)"] || 0),
          0,
        );
        const byWh = new Map<string, number>();
        for (const r of filteredBalances) {
          byWh.set(
            String(r.Company),
            (byWh.get(String(r.Company)) || 0) + Number(r["Value (purchase)"] || 0),
          );
        }
        const whBars = [...byWh.entries()]
          .map(([name, v]) => ({ name, value: v }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 6);
        return (
          <>
            <StatsGrid>
              <StatCard
                label="SKU rows"
                value={filteredBalances.length}
                format="number"
                icon={Package}
                hint="Matches company, status, and stock filters"
              />
              <StatCard
                label="Low stock"
                value={low}
                format="number"
                icon={AlertTriangle}
                tone={low > 0 ? "warn" : "ok"}
                hint="Need refill before market shortages"
              />
              <StatCard
                label="Purchase value"
                value={purchaseValue}
                format="money"
                icon={Boxes}
                tone="brand"
                hint="On-hand qty × purchase rate"
              />
              <StatCard
                label="Retail value"
                value={retailValue}
                format="money"
                icon={Boxes}
                hint="On-hand qty × retail rate"
              />
              <StatCard
                label="Movements shown"
                value={movementRows.length}
                format="number"
                tone="neutral"
                hint="Latest stock in/out activity"
              />
            </StatsGrid>
            <div className="grid gap-4 lg:grid-cols-3">
              <ChartCard title="Stock health" subtitle="OK vs low lines">
                <DonutChart
                  data={[
                    { name: "OK", value: Math.max(filteredBalances.length - low, 0) },
                    { name: "Low", value: low },
                  ].filter((x) => x.value > 0)}
                  centerValue={String(filteredBalances.length)}
                  centerLabel="SKU rows"
                />
              </ChartCard>
              <ChartCard
                className="lg:col-span-2"
                title="Value by company"
                subtitle="Purchase value in the current filter"
              >
                <RankBars data={whBars} />
              </ChartCard>
            </div>
          </>
        );
      })()}

      <ReportTable
        title={title}
        companyName={company.name}
        subtitle={`${activeRows.length} rows`}
        rows={activeRows}
        filename={`stock-${view}`}
        filters={<StockReportFilters companies={warehouses || []} />}
      />
    </div>
  );
}

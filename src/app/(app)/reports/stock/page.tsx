import { ChartCard } from "@/components/analytics/chart-card";
import { DonutChart, RankBars } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { ReportTable } from "@/components/reports/report-table";
import { requireCompanyContext } from "@/lib/auth";
import { formatPkr } from "@/lib/utils";
import { AlertTriangle, Boxes, Package } from "lucide-react";
import Link from "next/link";

export default async function StockReportPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view || "balances";
  const { supabase, company } = await requireCompanyContext();

  const [{ data: rows }, { data: movements }, { data: products }] =
    await Promise.all([
      supabase
        .from("stock_balances")
        .select("qty, products(code, name_en, reorder_level, purchase_rate, manufacturer), warehouses(name)")
        .eq("company_id", company.id)
        .order("qty", { ascending: false })
        .limit(1000),
      supabase
        .from("stock_movements")
        .select("created_at, move_type, qty, products(code, name_en), warehouses(name)")
        .eq("company_id", company.id)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("products")
        .select("code, name_en, manufacturer, category_group, reorder_level, opening_qty, purchase_rate, retail_rate")
        .eq("company_id", company.id)
        .eq("is_active", true)
        .order("code")
        .limit(1000),
    ]);

  const balanceRows = (rows || []).map((r) => {
    const product = Array.isArray(r.products) ? r.products[0] : r.products;
    const warehouse = Array.isArray(r.warehouses) ? r.warehouses[0] : r.warehouses;
    const qty = Number(r.qty);
    const rate = Number(product?.purchase_rate || 0);
    return {
      Company: warehouse?.name || "—",
      Code: product?.code || "—",
      Product: product?.name_en || "—",
      Manufacturer: product?.manufacturer || "—",
      Qty: qty,
      Reorder: Number(product?.reorder_level || 0),
      "Value (cost)": qty * rate,
      Status:
        Number(product?.reorder_level || 0) > 0 &&
        qty <= Number(product?.reorder_level || 0)
          ? "Low"
          : "OK",
    };
  });

  const analysisRows = (products || []).map((p) => ({
    Code: p.code,
    Product: p.name_en,
    Manufacturer: p.manufacturer || "—",
    Group: p.category_group || "—",
    "Opening qty": Number(p.opening_qty || 0),
    Reorder: Number(p.reorder_level || 0),
    "Purchase rate": Number(p.purchase_rate || 0),
    "Retail rate": Number(p.retail_rate || 0),
  }));

  const movementRows = (movements || []).map((m) => {
    const product = Array.isArray(m.products) ? m.products[0] : m.products;
    const warehouse = Array.isArray(m.warehouses) ? m.warehouses[0] : m.warehouses;
    return {
      When: new Date(m.created_at).toLocaleString(),
      Type: String(m.move_type).replaceAll("_", " "),
      Company: warehouse?.name || "—",
      Code: product?.code || "—",
      Product: product?.name_en || "—",
      Qty: Number(m.qty),
    };
  });

  const activeRows =
    view === "analysis"
      ? analysisRows
      : view === "movements"
        ? movementRows
        : balanceRows;

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
            href={`/reports/stock?view=${key}`}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              view === key
                ? "bg-[var(--brand)] !text-white"
                : "border border-[var(--border)] bg-white text-[var(--muted)]"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {(() => {
        const low = balanceRows.filter((r) => r.Status === "Low").length;
        const value = balanceRows.reduce(
          (s, r) => s + Number(r["Value (cost)"] || 0),
          0,
        );
        const byWh = new Map<string, number>();
        for (const r of balanceRows) {
          byWh.set(
            String(r.Company),
            (byWh.get(String(r.Company)) || 0) + Number(r["Value (cost)"] || 0),
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
                value={balanceRows.length}
                format="number"
                icon={Package}
                hint="Company × product lines"
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
                label="Stock value (cost)"
                value={value}
                format="money"
                icon={Boxes}
                tone="brand"
                hint="Inventory capital on hand"
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
                    { name: "OK", value: Math.max(balanceRows.length - low, 0) },
                    { name: "Low", value: low },
                  ].filter((x) => x.value > 0)}
                  centerValue={formatPkr(value)}
                  centerLabel="Cost value"
                />
              </ChartCard>
              <ChartCard
                className="lg:col-span-2"
                title="Value by company"
                subtitle="Where inventory capital sits"
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
      />
    </div>
  );
}

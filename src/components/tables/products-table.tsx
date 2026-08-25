"use client";

import { ChartCard } from "@/components/analytics/chart-card";
import { DonutChart, RankBars } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { ProductForm } from "@/components/forms/product-form";
import { FilterChip } from "@/components/tables/filter-chip";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { useClientPagination } from "@/hooks/use-client-pagination";
import { createClient } from "@/lib/supabase/client";
import type { Product, Warehouse } from "@/lib/types/database";
import { formatNumber, formatPkr } from "@/lib/utils";
import { AlertTriangle, Package, Tags } from "lucide-react";
import { useMemo, useState } from "react";

function productFields(p: Product): DetailField[] {
  return [
    { label: "Code", value: p.code },
    { label: "Name", value: p.name_en },
    { label: "Urdu name", value: p.name_ur || "—" },
    { label: "Type", value: p.product_type || "—" },
    { label: "Manufacturer", value: p.manufacturer || "—" },
    { label: "Group", value: p.category_group || "—" },
    { label: "Barcode", value: p.barcode || "—" },
    { label: "Retail", value: formatPkr(p.retail_rate) },
    { label: "Purchase", value: formatPkr(p.purchase_rate) },
    { label: "Wholesale", value: formatPkr(p.wholesale_rate) },
    { label: "Sale", value: formatPkr(p.sale_rate) },
    { label: "Opening qty", value: formatNumber(p.opening_qty, 3) },
    { label: "Opening rate", value: formatPkr(p.opening_rate) },
    { label: "Reorder", value: formatNumber(p.reorder_level, 0) },
    { label: "Packing", value: formatNumber(p.packing, 0) },
    { label: "Bonus", value: p.scheme || "—" },
    { label: "Status", value: p.is_active ? "Active" : "Inactive" },
  ];
}

type ViewFilter = "all" | "reorder";

export function ProductsTable({
  products,
  warehouses,
  companyId,
  organizationId,
  stockValueByCode,
  lowStockCodes,
  initialView,
}: {
  products: Product[];
  warehouses: Warehouse[];
  companyId: string;
  organizationId: string;
  stockValueByCode?: Record<string, number>;
  lowStockCodes?: string[];
  initialView?: string;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewFilter>(
    initialView === "reorder" ? "reorder" : "all",
  );
  const lowSet = useMemo(() => new Set(lowStockCodes || []), [lowStockCodes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (view === "reorder" && !(Number(p.reorder_level) > 0)) return false;
      if (!q) return true;
      return [p.code, p.name_en, p.manufacturer, p.category_group, p.product_type]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [products, query, view]);

  const pager = useClientPagination(filtered);

  const stockValue = filtered.reduce(
    (s, p) => s + Number(stockValueByCode?.[p.code] || 0),
    0,
  );
  const lowCount = filtered.filter((p) => lowSet.has(p.code)).length;
  const withReorder = filtered.filter((p) => Number(p.reorder_level) > 0).length;

  const makers = new Map<string, number>();
  for (const p of filtered) {
    const key = p.manufacturer || "Unbranded";
    makers.set(key, (makers.get(key) || 0) + 1);
  }
  const makerBars = [...makers.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const topStock = filtered
    .map((p) => ({
      name: `${p.code} — ${p.name_en}`,
      value: Number(stockValueByCode?.[p.code] || 0),
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const health = [
    { name: "Healthy", value: Math.max(filtered.length - lowCount, 0) },
    { name: "Low stock", value: lowCount },
  ].filter((x) => x.value > 0);

  async function deactivate(id: string) {
    const supabase = createClient();
    const { error } = await supabase
      .from("products")
      .update({ is_active: false })
      .eq("id", id);
    if (error) throw new Error(error.message);
  }

  return (
    <div className="space-y-6">
      <StatsGrid>
        <StatCard
          label="SKUs in filter"
          value={filtered.length}
          format="number"
          icon={Package}
          hint="Matches current search / chips"
        />
        <StatCard
          label="Stock value"
          value={stockValue}
          format="money"
          icon={Tags}
          tone="ok"
          hint="Filtered catalog value"
        />
        <button type="button" className="text-left" onClick={() => setView("reorder")}>
          <StatCard
            label="With reorder level"
            value={withReorder}
            format="number"
            icon={AlertTriangle}
            tone={view === "reorder" ? "brand" : "warn"}
            hint="Click to filter table"
          />
        </button>
        <StatCard
          label="Low stock SKUs"
          value={lowCount}
          format="number"
          tone={lowCount > 0 ? "danger" : "ok"}
          hint="Inside current filter"
        />
      </StatsGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Stock health" subtitle="Based on current filter">
          <DonutChart
            data={health}
            centerValue={formatPkr(stockValue)}
            centerLabel="Value"
          />
        </ChartCard>
        <ChartCard title="By manufacturer" subtitle="Updates with filters">
          <RankBars data={makerBars} money={false} />
        </ChartCard>
        <ChartCard title="Highest stock value" subtitle="In filtered set">
          <RankBars data={topStock} />
        </ChartCard>
      </div>

      <div>
        <TableToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="Search code, name, brand, group..."
          resultCount={filtered.length}
          totalCount={products.length}
          filters={
            <>
              {(
                [
                  ["all", "All"],
                  ["reorder", "Reorder set"],
                ] as const
              ).map(([key, label]) => (
                <FilterChip
                  key={key}
                  active={view === key}
                  onClick={() => setView(key)}
                >
                  {label}
                </FilterChip>
              ))}
            </>
          }
        />

        <div className="table-shell">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Brand / Group</th>
                  <th>Retail</th>
                  <th>Purchase</th>
                  <th>Reorder</th>
                  <th>Packing</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.slice.length ? (
                  pager.slice.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium">{p.code}</td>
                      <td>
                        <div>{p.name_en}</div>
                        <div className="text-xs text-[var(--muted)]">
                          {p.product_type || "—"}
                        </div>
                      </td>
                      <td className="text-[var(--muted)]">
                        {[p.manufacturer, p.category_group]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td>{formatPkr(p.retail_rate)}</td>
                      <td>{formatPkr(p.purchase_rate)}</td>
                      <td>{formatNumber(p.reorder_level, 0)}</td>
                      <td>{formatNumber(p.packing, 0)}</td>
                      <td>
                        <RowActions
                          viewTitle={p.name_en}
                          editTitle={`Edit ${p.name_en}`}
                          deleteTitle={`Remove ${p.name_en}?`}
                          deleteDescription="Product will be removed from this list and hidden from new invoices."
                          viewFields={productFields(p)}
                          onDelete={() => deactivate(p.id)}
                          editContent={(close) => (
                            <ProductForm
                              companyId={companyId}
                              organizationId={organizationId}
                              warehouses={warehouses}
                              initial={p}
                              onDone={close}
                            />
                          )}
                        />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-8 text-center text-[var(--muted)]"
                    >
                      No products match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={pager.page}
            totalPages={pager.totalPages}
            pageSize={pager.pageSize}
            total={pager.total}
            from={pager.from}
            to={pager.to}
            onPageChange={pager.setPage}
            onPageSizeChange={pager.setPageSize}
          />
        </div>
      </div>
    </div>
  );
}

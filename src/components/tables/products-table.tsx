"use client";

import { ChartCard } from "@/components/analytics/chart-card";
import { DonutChart, RankBars } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { ProductForm } from "@/components/forms/product-form";
import { FilterChip } from "@/components/tables/filter-chip";
import {
  TableFilterSelect,
  warehouseOptions,
} from "@/components/tables/table-filter-select";
import { TableBodySkeleton } from "@/components/tables/table-body-skeleton";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { useUrlTableState } from "@/hooks/use-url-table-state";
import type { PaginationMeta } from "@/lib/pagination";
import type { ProductListStats } from "@/lib/queries/products";
import { createClient } from "@/lib/supabase/client";
import type { Product, Warehouse } from "@/lib/types/database";
import { formatNumber, formatPkr } from "@/lib/utils";
import { AlertTriangle, Package, Tags } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
  pagination,
  stats,
  warehouses,
  companyId,
  organizationId,
  stockValueByCode,
  lowStockCodes,
  initialView,
}: {
  products: Product[];
  pagination: PaginationMeta;
  stats: ProductListStats;
  warehouses: Warehouse[];
  companyId: string;
  organizationId: string;
  stockValueByCode?: Record<string, number>;
  lowStockCodes?: string[];
  initialView?: string;
}) {
  const { q, isPending, setPage, setPageSize, setQuery, setFilter, filters } =
    useUrlTableState(["view", "warehouse"]);
  const [localQuery, setLocalQuery] = useState(q);
  const lowSet = useMemo(() => new Set(lowStockCodes || []), [lowStockCodes]);

  const view = (filters.view ||
    (initialView === "reorder" ? "reorder" : "all")) as ViewFilter;

  useEffect(() => {
    setLocalQuery(q);
  }, [q]);

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
          value={stats.total}
          format="number"
          icon={Package}
          hint="Matches current search / chips"
        />
        <StatCard
          label="Stock value (page)"
          value={stats.stockValue}
          format="money"
          icon={Tags}
          tone="ok"
          hint="Current page catalog value"
        />
        <button
          type="button"
          className="text-left"
          onClick={() => setFilter("view", "reorder")}
        >
          <StatCard
            label="With reorder level"
            value={stats.withReorder}
            format="number"
            icon={AlertTriangle}
            tone={view === "reorder" ? "brand" : "warn"}
            hint="Click to filter table"
          />
        </button>
        <StatCard
          label="Low stock SKUs"
          value={stats.lowStock}
          format="number"
          tone={stats.lowStock > 0 ? "danger" : "ok"}
          hint="Company-wide flagged SKUs"
        />
      </StatsGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Stock health" subtitle="Current page">
          <DonutChart
            data={stats.health}
            centerValue={formatPkr(stats.stockValue)}
            centerLabel="Value"
          />
        </ChartCard>
        <ChartCard title="By manufacturer" subtitle="Current page">
          <RankBars data={stats.makerBars} money={false} />
        </ChartCard>
        <ChartCard title="Highest stock value" subtitle="Current page">
          <RankBars data={stats.topStock} />
        </ChartCard>
      </div>

      <div>
        <TableToolbar
          query={localQuery}
          onQueryChange={(value) => {
            setLocalQuery(value);
            setQuery(value);
          }}
          loading={isPending}
          placeholder="Search code, name, brand, group..."
          resultCount={pagination.total}
          totalCount={pagination.total}
          filters={
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  ["all", "All"],
                  ["reorder", "Reorder set"],
                ] as const
              ).map(([key, label]) => (
                <FilterChip
                  key={key}
                  active={view === key}
                  onClick={() =>
                    setFilter("view", key === "all" ? null : key)
                  }
                >
                  {label}
                </FilterChip>
              ))}
              {warehouses.length ? (
                <TableFilterSelect
                  label="Warehouse"
                  value={filters.warehouse || ""}
                  options={warehouseOptions(warehouses)}
                  loading={isPending}
                  onChange={(value) => setFilter("warehouse", value)}
                />
              ) : null}
            </div>
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
                {isPending ? (
                  <TableBodySkeleton rows={pagination.pageSize} cols={8} />
                ) : products.length ? (
                  products.map((p) => (
                    <tr
                      key={p.id}
                      className={lowSet.has(p.code) ? "bg-rose-50/40" : undefined}
                    >
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
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            total={pagination.total}
            from={pagination.from}
            to={pagination.to}
            loading={isPending}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      </div>
    </div>
  );
}

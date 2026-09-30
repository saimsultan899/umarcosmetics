"use client";

import {
  TableFilterSelect,
  warehouseOptions,
} from "@/components/tables/table-filter-select";
import { useUrlTableState } from "@/hooks/use-url-table-state";

export function StockReportFilters({
  companies,
}: {
  companies: Array<{ id: string; name: string }>;
}) {
  const { filters, setFilter, isPending } = useUrlTableState([
    "company",
    "status",
    "stock",
  ]);

  return (
    <div className="no-print contents">
      <TableFilterSelect
        label="Company"
        value={filters.company || ""}
        options={warehouseOptions(companies)}
        loading={isPending}
        allLabel="All companies"
        onChange={(value) => setFilter("company", value)}
      />
      <TableFilterSelect
        label="Status"
        value={filters.status || ""}
        options={[
          { value: "low", label: "Low" },
          { value: "ok", label: "OK" },
        ]}
        loading={isPending}
        allLabel="All"
        compact
        onChange={(value) => setFilter("status", value)}
      />
      <TableFilterSelect
        label="Stock"
        value={filters.stock || ""}
        options={[
          { value: "in", label: "In stock" },
          { value: "zero", label: "Zero" },
        ]}
        loading={isPending}
        allLabel="All"
        compact
        onChange={(value) => setFilter("stock", value)}
      />
    </div>
  );
}

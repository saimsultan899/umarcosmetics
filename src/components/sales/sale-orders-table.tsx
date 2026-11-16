"use client";

import { ChartCard } from "@/components/analytics/chart-card";
import { TrendAreaChart } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { TableFilterSelect } from "@/components/tables/table-filter-select";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableScroll } from "@/components/tables/table-scroll";
import { SaleOrderRowActions } from "@/components/sales/sale-order-row-actions";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { useSearchInput, useUrlTableState } from "@/hooks/use-url-table-state";
import type { PaginationMeta } from "@/lib/pagination";
import type { SaleOrderListSummary } from "@/lib/queries/sale-order-list";
import type { SaleOrderListRow } from "@/lib/sales/sale-orders";
import { cn, formatPkr } from "@/lib/utils";
import { CheckCircle2, ClipboardList, CircleOff, ShoppingCart } from "lucide-react";
import Link from "next/link";

const FILTER_KEYS = ["fromDate", "toDate", "salesman", "status"];

function shortDate(value: string) {
  const [y, m, d] = value.slice(0, 10).split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

function statusLabel(status: string) {
  if (status === "fulfilled") return "Fulfilled";
  if (status === "cancelled") return "Cancelled";
  return "Open";
}

export function SaleOrdersTable({
  rows,
  pagination,
  summary,
  salesmen,
}: {
  rows: SaleOrderListRow[];
  pagination: PaginationMeta;
  summary: SaleOrderListSummary;
  salesmen: Array<{ id: string; full_name: string }>;
}) {
  const { q, isPending, setPage, setPageSize, setQuery, setFilter, filters } =
    useUrlTableState(FILTER_KEYS);
  const search = useSearchInput(q, setQuery);
  const status = filters.status || "";

  function toggleStatus(next: string) {
    setFilter("status", status === next ? null : next);
  }

  return (
    <div className="space-y-6">
      <StatsGrid>
        <button type="button" className="text-left" onClick={() => toggleStatus("open")}>
          <StatCard
            label="Open"
            value={summary.openCount}
            format="number"
            icon={ClipboardList}
            tone={status === "open" ? "brand" : "warn"}
            hint={`${formatPkr(summary.openAmount)} waiting to bill`}
          />
        </button>
        <button
          type="button"
          className="text-left"
          onClick={() => toggleStatus("fulfilled")}
        >
          <StatCard
            label="Fulfilled"
            value={summary.fulfilledCount}
            format="number"
            icon={CheckCircle2}
            tone={status === "fulfilled" ? "brand" : "ok"}
            hint={`${formatPkr(summary.fulfilledAmount)} billed`}
          />
        </button>
        <button
          type="button"
          className="text-left"
          onClick={() => toggleStatus("cancelled")}
        >
          <StatCard
            label="Cancelled"
            value={summary.cancelledCount}
            format="number"
            icon={CircleOff}
            tone={status === "cancelled" ? "brand" : "neutral"}
            hint={`${formatPkr(summary.cancelledAmount)} not billed`}
          />
        </button>
        <StatCard
          label="In filter"
          value={summary.filteredAmount}
          format="money"
          icon={ShoppingCart}
          hint={`${pagination.total} orders · ${summary.filteredQty} qty`}
        />
      </StatsGrid>

      <ChartCard title="Daily order total" subtitle="Matching the current filters">
        <TrendAreaChart data={summary.trend} valueLabel="Amount" height={220} />
      </ChartCard>

      <div>
        <TableToolbar
          query={search.query}
          onQueryChange={search.onQueryChange}
          onFocus={search.onFocus}
          onBlur={search.onBlur}
          placeholder="Search order #, salesman, or customer..."
          resultCount={pagination.total}
          totalCount={pagination.total}
          loading={isPending}
          filters={
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  From
                </span>
                <input
                  type="date"
                  value={filters.fromDate || ""}
                  onChange={(event) => setFilter("fromDate", event.target.value || null)}
                  className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
                />
              </label>
              <label className="inline-flex items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                  To
                </span>
                <input
                  type="date"
                  value={filters.toDate || ""}
                  onChange={(event) => setFilter("toDate", event.target.value || null)}
                  className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
                />
              </label>
              <TableFilterSelect
                label="Salesman"
                value={filters.salesman || ""}
                options={[
                  { value: "unassigned", label: "Unassigned" },
                  ...salesmen.map((row) => ({ value: row.id, label: row.full_name })),
                ]}
                onChange={(value) => setFilter("salesman", value)}
              />
              <TableFilterSelect
                label="Status"
                value={status}
                options={[
                  { value: "open", label: "Open" },
                  { value: "fulfilled", label: "Fulfilled" },
                  { value: "cancelled", label: "Cancelled" },
                ]}
                onChange={(value) => setFilter("status", value)}
              />
            </div>
          }
        />

        <div className="table-shell">
          <TableScroll loading={isPending}>
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Date</th>
                  <th>Salesman</th>
                  <th>Customer</th>
                  <th>Companies</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Amount</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((row) => (
                    <tr key={row.id}>
                      <td className="font-medium">
                        <Link href={`/sales/orders/${row.id}`} className="text-[var(--brand)]">
                          {row.orderNo}
                        </Link>
                        {row.note ? (
                          <p className="mt-0.5 max-w-[14rem] truncate text-[11px] font-normal text-[var(--muted)]">
                            {row.note}
                          </p>
                        ) : null}
                      </td>
                      <td>{shortDate(row.orderDate)}</td>
                      <td>{row.salesmanName}</td>
                      <td>{row.partyName}</td>
                      <td>{row.companies.join(", ") || "—"}</td>
                      <td className="text-right">{row.qty}</td>
                      <td className="text-right">{formatPkr(row.amount)}</td>
                      <td>
                        <span
                          className={cn(
                            "rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-medium",
                            row.status === "open"
                              ? "bg-amber-500/15 text-amber-800"
                              : row.status === "fulfilled"
                                ? "bg-emerald-500/15 text-emerald-800"
                                : "bg-[var(--surface-2)] text-[var(--muted)]",
                          )}
                        >
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td className="text-right">
                        <SaleOrderRowActions row={row} />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-[var(--muted)]">
                      No orders match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length ? (
                <tfoot>
                  <tr className="border-t-2 border-[var(--border)] bg-[var(--surface-2)] font-semibold">
                    <td colSpan={5}>
                      Total ({pagination.total}{" "}
                      {pagination.total === 1 ? "order" : "orders"})
                    </td>
                    <td className="text-right">{summary.filteredQty}</td>
                    <td className="text-right">{formatPkr(summary.filteredAmount)}</td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </TableScroll>
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

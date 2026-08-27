"use client";

import { ChartCard } from "@/components/analytics/chart-card";
import { DonutChart, TrendAreaChart } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { DocumentRowActions } from "@/components/tables/document-row-actions";
import { FilterChip } from "@/components/tables/filter-chip";
import {
  TableFilterSelect,
  warehouseOptions,
} from "@/components/tables/table-filter-select";
import { TableScroll } from "@/components/tables/table-scroll";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { useUrlTableState } from "@/hooks/use-url-table-state";
import type {
  DocumentListRow,
  DocumentListSummary,
} from "@/lib/queries/documents";
import type { PaginationMeta } from "@/lib/pagination";
import { formatPkr } from "@/lib/utils";
import { Banknote, CreditCard, FileText, ShoppingCart } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type { DocumentListRow };

export function DocumentListTable({
  title,
  rows,
  pagination,
  summary,
  showPaymentFilter = false,
  warehouses = [],
}: {
  title?: string;
  rows: DocumentListRow[];
  pagination: PaginationMeta;
  summary: DocumentListSummary;
  showPaymentFilter?: boolean;
  warehouses?: Array<{ id: string; name: string }>;
}) {
  const filterKeys = useMemo(
    () => [
      ...(showPaymentFilter ? ["payment"] : []),
      ...(warehouses.length ? ["warehouse"] : []),
    ],
    [showPaymentFilter, warehouses.length],
  );
  const { q, isPending, setPage, setPageSize, setQuery, setFilter, filters } =
    useUrlTableState(filterKeys);
  const [localQuery, setLocalQuery] = useState(q);
  const payment = (filters.payment || "all") as
    | "all"
    | "cash"
    | "credit"
    | "partial";

  useEffect(() => {
    setLocalQuery(q);
  }, [q]);

  return (
    <div className="space-y-6">
      <StatsGrid>
        <StatCard
          label="In filter"
          value={pagination.total}
          format="number"
          icon={FileText}
          hint={title || "Documents matching filter"}
        />
        <StatCard
          label="Recent total"
          value={summary.totalAmount}
          format="money"
          icon={ShoppingCart}
          hint="Latest 300 documents snapshot"
        />
        {showPaymentFilter ? (
          <>
            <button
              type="button"
              className="text-left"
              onClick={() => setFilter("payment", "cash")}
            >
              <StatCard
                label="Cash"
                value={summary.cashTotal}
                format="money"
                icon={Banknote}
                tone={payment === "cash" ? "brand" : "ok"}
                hint="Click to filter table"
              />
            </button>
            <button
              type="button"
              className="text-left"
              onClick={() => setFilter("payment", "credit")}
            >
              <StatCard
                label="Credit / partial"
                value={summary.creditTotal}
                format="money"
                icon={CreditCard}
                tone={payment === "credit" ? "brand" : "warn"}
                hint="Click to filter table"
              />
            </button>
          </>
        ) : (
          <StatCard
            label="Avg document"
            value={
              pagination.total ? summary.totalAmount / Math.min(300, pagination.total) : 0
            }
            format="money"
            tone="neutral"
            hint="Recent average"
          />
        )}
      </StatsGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Daily total"
          subtitle="Recent documents"
        >
          <TrendAreaChart data={summary.trend} valueLabel="Amount" />
        </ChartCard>
        {showPaymentFilter ? (
          <ChartCard title="Payment mix" subtitle="Recent documents">
            <DonutChart
              data={summary.mix}
              centerValue={formatPkr(summary.totalAmount)}
              centerLabel="Total"
            />
          </ChartCard>
        ) : (
          <ChartCard title="Summary" subtitle="Recent amount">
            <div className="flex h-full min-h-[220px] flex-col justify-center gap-3">
              <p className="text-sm text-[var(--muted)]">Recent total</p>
              <p className="font-[family-name:var(--font-display)] text-3xl font-semibold">
                {formatPkr(summary.totalAmount)}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {pagination.total} documents · server-paginated below
              </p>
            </div>
          </ChartCard>
        )}
      </div>

      <div>
        <TableToolbar
          query={localQuery}
          onQueryChange={(value) => {
            setLocalQuery(value);
            setQuery(value);
          }}
          loading={isPending}
          placeholder="Search doc #..."
          resultCount={pagination.total}
          totalCount={pagination.total}
          filters={
            <div className="flex flex-wrap items-center gap-2">
              {showPaymentFilter
                ? (
                    [
                      ["all", "All"],
                      ["cash", "Cash"],
                      ["credit", "Credit"],
                      ["partial", "Partial"],
                    ] as const
                  ).map(([key, label]) => (
                    <FilterChip
                      key={key}
                      active={payment === key}
                      onClick={() =>
                        setFilter("payment", key === "all" ? null : key)
                      }
                    >
                      {label}
                    </FilterChip>
                  ))
                : null}
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
          <TableScroll loading={isPending}>
            <table>
              <thead>
                <tr>
                  <th>Doc #</th>
                  <th>Date</th>
                  <th>Party</th>
                  <th>Warehouse</th>
                  {showPaymentFilter ? <th>Payment</th> : null}
                  <th>Total</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((inv) => (
                    <tr key={inv.id}>
                      <td className="font-medium">{inv.docNo}</td>
                      <td>{inv.date}</td>
                      <td>{inv.partyLabel}</td>
                      <td>{inv.warehouseLabel || "—"}</td>
                      {showPaymentFilter ? (
                        <td className="text-xs font-semibold uppercase">
                          {inv.paymentType || "—"}
                        </td>
                      ) : null}
                      <td>{formatPkr(inv.total)}</td>
                      <td>
                        <DocumentRowActions
                          title={inv.docNo}
                          href={inv.href}
                          table={inv.table}
                          id={inv.id}
                          linesTable={inv.linesTable}
                          linesFk={inv.linesFk}
                          fields={[
                            { label: "Doc #", value: inv.docNo },
                            { label: "Date", value: inv.date },
                            { label: "Party", value: inv.partyLabel },
                            {
                              label: "Warehouse",
                              value: inv.warehouseLabel || "—",
                            },
                            ...(inv.paymentType
                              ? [{ label: "Payment", value: inv.paymentType }]
                              : []),
                            { label: "Total", value: formatPkr(inv.total) },
                            ...(inv.extraFields || []),
                          ]}
                        />
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={showPaymentFilter ? 7 : 6}
                      className="py-8 text-center text-[var(--muted)]"
                    >
                      No documents match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
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

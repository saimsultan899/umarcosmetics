"use client";

import { DocumentRowActions } from "@/components/tables/document-row-actions";
import { TableBodySkeleton } from "@/components/tables/table-body-skeleton";
import {
  TableFilterSelect,
  warehouseOptions,
} from "@/components/tables/table-filter-select";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { useUrlTableState } from "@/hooks/use-url-table-state";
import type { StockTransferRow } from "@/lib/queries/stock-transfers";
import type { PaginationMeta } from "@/lib/pagination";
import { useEffect, useState } from "react";

export function TransfersTable({
  rows,
  pagination,
  warehouses = [],
}: {
  rows: StockTransferRow[];
  pagination: PaginationMeta;
  warehouses?: Array<{ id: string; name: string }>;
}) {
  const { q, isPending, setPage, setPageSize, setQuery, setFilter, filters } =
    useUrlTableState(warehouses.length ? ["from", "to"] : []);
  const [localQuery, setLocalQuery] = useState(q);

  useEffect(() => {
    setLocalQuery(q);
  }, [q]);

  return (
    <div>
      <TableToolbar
        query={localQuery}
        onQueryChange={(value) => {
          setLocalQuery(value);
          setQuery(value);
        }}
        loading={isPending}
        placeholder="Search transfer #..."
        resultCount={pagination.total}
        totalCount={pagination.total}
        filters={
          warehouses.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <TableFilterSelect
                label="From"
                value={filters.from || ""}
                options={warehouseOptions(warehouses)}
                loading={isPending}
                onChange={(value) => setFilter("from", value)}
              />
              <TableFilterSelect
                label="To"
                value={filters.to || ""}
                options={warehouseOptions(warehouses)}
                loading={isPending}
                onChange={(value) => setFilter("to", value)}
              />
            </div>
          ) : undefined
        }
      />
      <div className="table-shell">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Transfer #</th>
                <th>Date</th>
                <th>From</th>
                <th>To</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isPending ? (
                <TableBodySkeleton rows={pagination.pageSize} cols={5} />
              ) : rows.length ? (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium">{row.transfer_no}</td>
                    <td>{row.transfer_date}</td>
                    <td>{row.from_name}</td>
                    <td>{row.to_name}</td>
                    <td>
                      <DocumentRowActions
                        title={`Transfer ${row.transfer_no}`}
                        href={`/warehouses/transfers/${row.id}`}
                        table="stock_transfers"
                        id={row.id}
                        linesTable="stock_transfer_items"
                        linesFk="stock_transfer_id"
                        fields={[
                          { label: "Transfer #", value: row.transfer_no },
                          { label: "Date", value: row.transfer_date },
                          { label: "From", value: row.from_name },
                          { label: "To", value: row.to_name },
                        ]}
                      />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[var(--muted)]">
                    No transfers yet.
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
  );
}

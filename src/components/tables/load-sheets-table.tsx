"use client";

import { TableBodySkeleton } from "@/components/tables/table-body-skeleton";
import {
  TableFilterSelect,
  warehouseOptions,
} from "@/components/tables/table-filter-select";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { useUrlTableState } from "@/hooks/use-url-table-state";
import type { LoadSheetRow } from "@/lib/queries/load-sheets";
import type { PaginationMeta } from "@/lib/pagination";
import Link from "next/link";
import { useEffect, useState } from "react";

export function LoadSheetsTable({
  rows,
  pagination,
  warehouses = [],
}: {
  rows: LoadSheetRow[];
  pagination: PaginationMeta;
  warehouses?: Array<{ id: string; name: string }>;
}) {
  const { q, isPending, setPage, setPageSize, setQuery, setFilter, filters } =
    useUrlTableState(warehouses.length ? ["warehouse"] : []);
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
        placeholder="Search sheet #, vehicle, route..."
        resultCount={pagination.total}
        totalCount={pagination.total}
        filters={
          warehouses.length ? (
            <TableFilterSelect
              label="Warehouse"
              value={filters.warehouse || ""}
              options={warehouseOptions(warehouses)}
              loading={isPending}
              onChange={(value) => setFilter("warehouse", value)}
            />
          ) : undefined
        }
      />
      <div className="table-shell">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sheet #</th>
                <th>Date</th>
                <th>Warehouse</th>
                <th>Vehicle / Sector</th>
                <th>Lines qty</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {isPending ? (
                <TableBodySkeleton rows={pagination.pageSize} cols={6} />
              ) : rows.length ? (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link
                        href={`/inventory/load-sheets/${r.id}`}
                        className="font-medium text-[var(--brand)] hover:underline"
                      >
                        {r.sheet_no}
                      </Link>
                    </td>
                    <td>{r.sheet_date}</td>
                    <td>{r.warehouse}</td>
                    <td className="text-[var(--muted)]">{r.vehicle_route}</td>
                    <td>{r.qty}</td>
                    <td>{r.status}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[var(--muted)]">
                    No load sheets yet. Issue your first van load above.
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

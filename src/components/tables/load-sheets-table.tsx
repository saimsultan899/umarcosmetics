"use client";

import { TableScroll } from "@/components/tables/table-scroll";
import {
  TableFilterSelect,
  warehouseOptions,
} from "@/components/tables/table-filter-select";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { useSearchInput, useUrlTableState } from "@/hooks/use-url-table-state";
import type { LoadSheetRow } from "@/lib/queries/load-sheets";
import type { PaginationMeta } from "@/lib/pagination";
import Link from "next/link";

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
  const search = useSearchInput(q, setQuery);

  return (
    <div>
      <TableToolbar
        query={search.query}
        onQueryChange={search.onQueryChange}
        onFocus={search.onFocus}
        onBlur={search.onBlur}
        placeholder="Search sheet #, vehicle, route..."
        resultCount={pagination.total}
        totalCount={pagination.total}
        filters={
          warehouses.length ? (
            <TableFilterSelect
              label="Company"
              value={filters.warehouse || ""}
              options={warehouseOptions(warehouses)}
              loading={isPending}
              onChange={(value) => setFilter("warehouse", value)}
            />
          ) : undefined
        }
      />
      <div className="table-shell">
        <TableScroll loading={isPending}>
          <table>
            <thead>
              <tr>
                <th>Sheet #</th>
                <th>Date</th>
                <th>Company</th>
                <th>Vehicle / Sector</th>
                <th>Lines qty</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
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
  );
}

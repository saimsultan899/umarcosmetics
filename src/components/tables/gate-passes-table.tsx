"use client";

import { DocumentRowActions } from "@/components/tables/document-row-actions";
import { TableScroll } from "@/components/tables/table-scroll";
import {
  TableFilterSelect,
  warehouseOptions,
} from "@/components/tables/table-filter-select";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { useUrlTableState } from "@/hooks/use-url-table-state";
import type { GatePassListRow } from "@/lib/queries/gate-passes";
import type { PaginationMeta } from "@/lib/pagination";
import Link from "next/link";
import { useEffect, useState } from "react";

export function GatePassesTable({
  rows,
  pagination,
  warehouses = [],
}: {
  rows: GatePassListRow[];
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
        placeholder="Search pass #, brand, vehicle..."
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
                <th>Pass #</th>
                <th>Date</th>
                <th>Vendor</th>
                <th>Company</th>
                <th>Brand</th>
                <th>Qty</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link
                        href={`/purchases/gate-passes/${r.id}`}
                        className="font-medium text-[var(--brand)] hover:underline"
                      >
                        {r.pass_no}
                      </Link>
                    </td>
                    <td>{r.pass_date}</td>
                    <td>{r.supplier}</td>
                    <td>{r.warehouse}</td>
                    <td className="text-[var(--muted)]">{r.brand}</td>
                    <td>{r.qty}</td>
                    <td>
                      <DocumentRowActions
                        title={`Gate pass ${r.pass_no}`}
                        href={`/purchases/gate-passes/${r.id}`}
                        table="gate_passes"
                        id={r.id}
                        linesTable="gate_pass_items"
                        linesFk="gate_pass_id"
                        showPrint
                        fields={[
                          { label: "Pass #", value: r.pass_no },
                          { label: "Date", value: r.pass_date },
                          { label: "Vendor", value: r.supplier },
                          { label: "Company", value: r.warehouse },
                          { label: "Brand", value: r.brand },
                          { label: "Qty", value: r.qty },
                        ]}
                      />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[var(--muted)]">
                    No gate passes yet. Record the incoming company load above.
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

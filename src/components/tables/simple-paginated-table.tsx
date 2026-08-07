"use client";

import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { useClientPagination } from "@/hooks/use-client-pagination";
import { useMemo, useState } from "react";

export function SimplePaginatedTable({
  columns,
  rows,
  searchKeys,
  emptyLabel = "No rows yet.",
  renderRow,
}: {
  columns: string[];
  rows: Array<Record<string, unknown> & { id: string; _search?: string }>;
  searchKeys?: string[];
  emptyLabel?: string;
  renderRow: (row: Record<string, unknown> & { id: string }) => React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const keys = searchKeys || columns;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      if (row._search && String(row._search).toLowerCase().includes(q)) {
        return true;
      }
      return keys.some((k) =>
        String(row[k] ?? "")
          .toLowerCase()
          .includes(q),
      );
    });
  }, [rows, query, keys]);

  const pager = useClientPagination(filtered);

  return (
    <div>
      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search table..."
        resultCount={filtered.length}
        totalCount={rows.length}
      />
      <div className="table-shell">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c}
                    className={
                      c.toLowerCase() === "actions" ? "text-right" : undefined
                    }
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pager.slice.length ? (
                pager.slice.map((row) => renderRow(row))
              ) : (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="py-8 text-center text-[var(--muted)]"
                  >
                    {emptyLabel}
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
  );
}

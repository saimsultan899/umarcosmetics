"use client";

import { TablePagination } from "@/components/tables/table-pagination";
import { TableScroll } from "@/components/tables/table-scroll";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { useClientPagination } from "@/hooks/use-client-pagination";
import { formatPkr } from "@/lib/utils";
import { useMemo, useState } from "react";

export type FieldPurchaseRow = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  grand_total: number;
  vendor: string;
};

function shortDate(value: string) {
  const [y, m, d] = value.slice(0, 10).split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

export function FieldPurchaseTable({ rows }: { rows: FieldPurchaseRow[] }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      `${row.invoice_no} ${row.vendor}`.toLowerCase().includes(q),
    );
  }, [rows, query]);
  const page = useClientPagination(visible);

  return (
    <div>
      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search bill or vendor"
        resultCount={page.total}
        totalCount={rows.length}
      />
      <div className="table-shell">
        <TableScroll loading={page.isPending}>
          <table>
            <thead>
              <tr>
                <th>Bill</th>
                <th>Date</th>
                <th>Vendor</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {page.slice.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-[var(--muted)]">
                    No purchase bills match.
                  </td>
                </tr>
              ) : (
                page.slice.map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium">{row.invoice_no}</td>
                    <td>{shortDate(row.invoice_date)}</td>
                    <td>{row.vendor || "—"}</td>
                    <td className="text-right">{formatPkr(row.grand_total)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableScroll>
        <TablePagination
          page={page.page}
          totalPages={page.totalPages}
          pageSize={page.pageSize}
          total={page.total}
          from={page.from}
          to={page.to}
          loading={page.isPending}
          onPageChange={page.setPage}
          onPageSizeChange={page.setPageSize}
        />
      </div>
    </div>
  );
}

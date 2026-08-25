"use client";

import { DocumentRowActions } from "@/components/tables/document-row-actions";
import { TableBodySkeleton } from "@/components/tables/table-body-skeleton";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { useUrlTableState } from "@/hooks/use-url-table-state";
import type { VoucherRow } from "@/lib/queries/vouchers";
import type { PaginationMeta } from "@/lib/pagination";
import { formatPkr } from "@/lib/utils";
import { useEffect, useState } from "react";

export function VouchersTable({
  vouchers,
  pagination,
  emptyLabel,
  detailBasePath,
}: {
  vouchers: VoucherRow[];
  pagination: PaginationMeta;
  emptyLabel: string;
  detailBasePath: string;
}) {
  const { q, isPending, setPage, setPageSize, setQuery } = useUrlTableState();
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
        placeholder="Search vouchers..."
        resultCount={pagination.total}
        totalCount={pagination.total}
      />
      <div className="table-shell">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Vr. No</th>
                <th>Date</th>
                <th>Total</th>
                <th>Narration</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isPending ? (
                <TableBodySkeleton rows={pagination.pageSize} cols={5} />
              ) : vouchers.length ? (
                vouchers.map((v) => (
                  <tr key={v.id}>
                    <td className="font-medium">{v.voucher_no}</td>
                    <td>{v.voucher_date}</td>
                    <td>{formatPkr(v.total_amount)}</td>
                    <td className="text-[var(--muted)]">{v.narration || "—"}</td>
                    <td>
                      <DocumentRowActions
                        title={`Voucher ${v.voucher_no}`}
                        href={`${detailBasePath}/${v.id}`}
                        table="vouchers"
                        id={v.id}
                        linesTable="voucher_lines"
                        linesFk="voucher_id"
                        fields={[
                          { label: "Voucher #", value: v.voucher_no },
                          { label: "Date", value: v.voucher_date },
                          { label: "Total", value: formatPkr(v.total_amount) },
                          { label: "Narration", value: v.narration || "—" },
                        ]}
                      />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[var(--muted)]">
                    {emptyLabel}
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

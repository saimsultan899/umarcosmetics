"use client";

import { DocumentRowActions } from "@/components/tables/document-row-actions";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { useClientPagination } from "@/hooks/use-client-pagination";
import { formatPkr } from "@/lib/utils";
import { useMemo, useState } from "react";

type VoucherRow = {
  id: string;
  voucher_no: string;
  voucher_date: string;
  total_amount: number;
  narration: string | null;
};

export function VouchersTable({
  vouchers,
  emptyLabel,
  detailBasePath,
}: {
  vouchers: VoucherRow[];
  emptyLabel: string;
  detailBasePath: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vouchers;
    return vouchers.filter((v) =>
      [v.voucher_no, v.voucher_date, v.narration, v.total_amount]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(q)),
    );
  }, [vouchers, query]);

  const pager = useClientPagination(filtered);

  return (
    <div>
      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search vouchers..."
        resultCount={filtered.length}
        totalCount={vouchers.length}
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
              {pager.slice.length ? (
                pager.slice.map((v) => (
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

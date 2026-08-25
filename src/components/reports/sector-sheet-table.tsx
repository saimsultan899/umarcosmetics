"use client";

import { TableBodySkeleton } from "@/components/tables/table-body-skeleton";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { useUrlTableState } from "@/hooks/use-url-table-state";
import { formatPkr } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";

export type SectorSheetRow = {
  party_id: string;
  party_code: string;
  name_en: string;
  city: string | null;
  route: string | null;
  balance: number;
};

export function SectorSheetTable({
  rows,
  companyName,
}: {
  rows: SectorSheetRow[];
  companyName: string;
}) {
  const { page, pageSize, q, isPending, setPage, setPageSize, setQuery } =
    useUrlTableState();
  const [localQuery, setLocalQuery] = useState(q);

  useEffect(() => {
    setLocalQuery(q);
  }, [q]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      [r.party_code, r.name_en, r.city, r.route, String(r.balance)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term)),
    );
  }, [rows, q]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const sliceFrom = (safePage - 1) * pageSize;
  const slice = filtered.slice(sliceFrom, sliceFrom + pageSize);
  const from = total === 0 ? 0 : sliceFrom + 1;
  const to = Math.min(safePage * pageSize, total);

  return (
    <div className="space-y-0">
      <div className="no-print border-b border-[var(--border)] px-4 py-3">
        <TableToolbar
          query={localQuery}
          onQueryChange={(value) => {
            setLocalQuery(value);
            setQuery(value);
          }}
          loading={isPending}
          placeholder="Search code, shop, sector..."
          resultCount={total}
          totalCount={rows.length}
        />
      </div>

      <div className="print-sheet table-shell">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <p className="font-semibold">Sector Sheet — {companyName}</p>
          <p className="text-xs text-[var(--muted)]">
            {new Date().toLocaleDateString()}
            {total !== rows.length ? ` · ${total} matching search` : ""}
          </p>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Shop</th>
                <th>Sector / City</th>
                <th>Balance</th>
                <th>Rec</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {isPending ? (
                <TableBodySkeleton rows={pageSize} cols={6} />
              ) : slice.length ? (
                slice.map((r) => (
                  <tr key={r.party_id}>
                    <td className="font-medium">{r.party_code}</td>
                    <td>{r.name_en}</td>
                    <td className="text-[var(--muted)]">
                      {[r.route, r.city].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="font-semibold text-rose-700">
                      {formatPkr(r.balance)} Dr
                    </td>
                    <td />
                    <td />
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[var(--muted)]">
                    No dues to print.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="no-print">
          <TablePagination
            page={safePage}
            totalPages={totalPages}
            pageSize={pageSize}
            total={total}
            from={from}
            to={to}
            loading={isPending}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      </div>
    </div>
  );
}

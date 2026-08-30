"use client";

import { TableScroll } from "@/components/tables/table-scroll";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { useUrlTableState } from "@/hooks/use-url-table-state";
import { formatPkr } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";

export type RecoveryOutstandingRow = {
  party_id: string;
  party_code: string;
  name_en: string;
  city: string | null;
  route: string | null;
  balance: number;
  credit_limit: number;
};

function balanceLabel(balance: number) {
  if (Math.abs(balance) < 0.005) return "Nil";
  if (balance > 0) return `${formatPkr(balance)} Dr`;
  return `${formatPkr(Math.abs(balance))} Cr`;
}

export function RecoveryOutstandingTable({
  rows,
  companyName,
  asOf,
  city,
  route,
}: {
  rows: RecoveryOutstandingRow[];
  companyName: string;
  asOf: string;
  city?: string;
  route?: string;
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
          placeholder="Search code, name, city, sector..."
          resultCount={total}
          totalCount={rows.length}
        />
      </div>

      <div id="print-area" className="table-shell">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <p className="font-[family-name:var(--font-display)] text-lg font-semibold">
            Customer receivables — {companyName}
          </p>
          <p className="text-xs text-[var(--muted)]">
            To {asOf}
            {city ? ` · ${city}` : ""}
            {route ? ` · ${route}` : ""}
            {total !== rows.length ? ` · ${total} matching search` : ""}
          </p>
        </div>
        <TableScroll loading={isPending}>
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>City / Sector</th>
                <th>Balance</th>
                <th>Credit Limit</th>
                <th>Rec</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {slice.length ? (
                slice.map((r) => (
                  <tr key={r.party_id}>
                    <td className="font-medium">{r.party_code}</td>
                    <td>{r.name_en}</td>
                    <td className="text-[var(--muted)]">
                      {[r.city, r.route].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="font-semibold text-rose-700">
                      {balanceLabel(Number(r.balance))}
                    </td>
                    <td>
                      {Number(r.credit_limit) > 0
                        ? formatPkr(r.credit_limit)
                        : "—"}
                    </td>
                    <td className="text-[var(--muted)]"> </td>
                    <td className="text-[var(--muted)]"> </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[var(--muted)]">
                    No outstanding debit balances for this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableScroll>
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

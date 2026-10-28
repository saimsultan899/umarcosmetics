"use client";

import { DocumentRowActions } from "@/components/tables/document-row-actions";
import { TableScroll } from "@/components/tables/table-scroll";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { TableFilterSelect, stringOptions } from "@/components/tables/table-filter-select";
import { CashReceiptView } from "@/components/vouchers/cash-receipt-view";
import { useSearchInput, useUrlTableState } from "@/hooks/use-url-table-state";
import type { VoucherRow } from "@/lib/queries/vouchers";
import type { PaginationMeta } from "@/lib/pagination";
import { formatPkr } from "@/lib/utils";
import Link from "next/link";

export function VouchersTable({
  vouchers,
  pagination,
  emptyLabel,
  detailBasePath,
  showParty = false,
  sectors = [],
  companyId,
}: {
  vouchers: VoucherRow[];
  pagination: PaginationMeta;
  emptyLabel: string;
  detailBasePath: string;
  /** Customer and sector columns, plus sector filter (cash receipts). */
  showParty?: boolean;
  sectors?: string[];
  companyId?: string;
}) {
  const filterKeys = [
    "fromDate",
    "toDate",
    ...(showParty && sectors.length ? ["sector"] : []),
  ];
  const { q, filters, isPending, setPage, setPageSize, setQuery, setFilter } =
    useUrlTableState(filterKeys);
  const search = useSearchInput(q, setQuery);
  const colSpan = showParty ? 7 : 5;

  return (
    <div>
      <TableToolbar
        query={search.query}
        onQueryChange={search.onQueryChange}
        onFocus={search.onFocus}
        onBlur={search.onBlur}
        placeholder={
          showParty
            ? "Search voucher, customer, sector, or narration..."
            : "Search vouchers..."
        }
        resultCount={pagination.total}
        totalCount={pagination.total}
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                From
              </span>
              <input
                type="date"
                value={filters.fromDate || ""}
                onChange={(e) => setFilter("fromDate", e.target.value || null)}
                className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
              />
            </label>
            <label className="inline-flex items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                To
              </span>
              <input
                type="date"
                value={filters.toDate || ""}
                onChange={(e) => setFilter("toDate", e.target.value || null)}
                className="h-9 rounded-lg border border-[var(--border)] bg-white px-2 text-sm"
              />
            </label>
            {showParty && sectors.length ? (
              <TableFilterSelect
                label="Sector"
                value={filters.sector || ""}
                options={stringOptions(sectors)}
                loading={isPending}
                onChange={(value) => setFilter("sector", value)}
              />
            ) : null}
          </div>
        }
      />
      <div className="table-shell">
        <TableScroll loading={isPending}>
          <table>
            <thead>
              <tr>
                <th>Vr. No</th>
                <th>Date</th>
                {showParty ? <th>Customer</th> : null}
                {showParty ? <th>Sector</th> : null}
                <th>Total</th>
                <th>Narration</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {vouchers.length ? (
                vouchers.map((v) => (
                  <tr key={v.id}>
                    <td className="font-medium">
                      <Link
                        href={`${detailBasePath}/${v.id}`}
                        className="text-[var(--brand)] hover:underline"
                      >
                        {v.voucher_no}
                      </Link>
                    </td>
                    <td>{v.voucher_date}</td>
                    {showParty ? (
                      <td
                        className="max-w-[12rem] truncate"
                        title={v.partyDetail || v.partyLabel}
                      >
                        {v.partyLabel || "—"}
                      </td>
                    ) : null}
                    {showParty ? (
                      <td
                        className="max-w-[10rem] truncate"
                        title={v.sectorDetail || v.sectorLabel}
                      >
                        {v.sectorLabel || "—"}
                      </td>
                    ) : null}
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
                          ...(showParty
                            ? [
                                {
                                  label: "Customer",
                                  value: v.partyDetail || v.partyLabel || "—",
                                },
                                {
                                  label: "Sector",
                                  value: v.sectorDetail || v.sectorLabel || "—",
                                },
                              ]
                            : []),
                          { label: "Total", value: formatPkr(v.total_amount) },
                          { label: "Narration", value: v.narration || "—" },
                        ]}
                        viewClassName={
                          showParty
                            ? "max-w-[96vw] sm:max-w-4xl lg:max-w-5xl"
                            : undefined
                        }
                        viewContent={
                          showParty && companyId ? (
                            <CashReceiptView
                              voucherId={v.id}
                              companyId={companyId}
                              fields={[
                                { label: "Voucher #", value: v.voucher_no },
                                { label: "Date", value: v.voucher_date },
                                {
                                  label: "Total",
                                  value: formatPkr(v.total_amount),
                                },
                                {
                                  label: "Narration",
                                  value: v.narration || "—",
                                },
                              ]}
                            />
                          ) : undefined
                        }
                      />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={colSpan} className="py-8 text-center text-[var(--muted)]">
                    {emptyLabel}
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

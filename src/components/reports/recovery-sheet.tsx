"use client";

import { ExportButtons } from "@/components/reports/export-buttons";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableScroll } from "@/components/tables/table-scroll";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { useUrlTableState } from "@/hooks/use-url-table-state";
import type {
  RecoverySheetResult,
  RecoverySheetRow,
  RecoverySheetSection,
} from "@/lib/reports/recovery-data";
import { formatReportDate } from "@/lib/reports/helpers";
import { formatNumber } from "@/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";

/** Balance → "7,434 Dr" / "1,825 Cr" / "Nil", matching the paper sheet. */
function balanceLabel(balance: number) {
  if (Math.abs(balance) < 0.005) return "Nil";
  if (balance > 0) return `${formatNumber(balance, 0)} Dr`;
  return `${formatNumber(Math.abs(balance), 0)} Cr`;
}

type Totals = { count: number; dueTotal: number; crTotal: number };

type FlatRow = RecoverySheetRow & { sector: string };

function totalsOf(rows: RecoverySheetRow[]): Totals {
  let dueTotal = 0;
  let crTotal = 0;
  for (const r of rows) {
    if (r.balance > 0.005) dueTotal += r.balance;
    else if (r.balance < -0.005) crTotal += Math.abs(r.balance);
  }
  return { count: rows.length, dueTotal, crTotal };
}

function matchRow(r: RecoverySheetRow, term: string) {
  return [r.party_code, r.name_en, r.city, r.route]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(term));
}

function filterSections(
  sections: RecoverySheetSection[],
  term: string,
): RecoverySheetSection[] {
  if (!term) return sections;
  return sections
    .map((s) => ({ ...s, rows: s.rows.filter((r) => matchRow(r, term)) }))
    .filter((s) => s.rows.length);
}

export function RecoverySheet({
  companyName,
  from,
  to,
  scopeLabel,
  sections,
  grand,
}: {
  companyName: string;
  from: string;
  to: string;
  scopeLabel: string;
  sections: RecoverySheetSection[];
  grand: RecoverySheetResult["grand"];
}) {
  const { page, pageSize, q, isPending, setPage, setPageSize, setQuery } =
    useUrlTableState();
  const [localQuery, setLocalQuery] = useState(q);
  const savedTitle = useRef("");

  useEffect(() => {
    setLocalQuery(q);
  }, [q]);

  // Hide browser print header title (often shows app name + URL footer).
  useEffect(() => {
    const onBeforePrint = () => {
      savedTitle.current = document.title;
      document.title = " ";
    };
    const onAfterPrint = () => {
      document.title = savedTitle.current;
    };
    window.addEventListener("beforeprint", onBeforePrint);
    window.addEventListener("afterprint", onAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      window.removeEventListener("afterprint", onAfterPrint);
    };
  }, []);

  const term = q.trim().toLowerCase();
  const filteredSections = useMemo(
    () => filterSections(sections, term),
    [sections, term],
  );

  const flatRows = useMemo<FlatRow[]>(
    () =>
      filteredSections.flatMap((s) =>
        s.rows.map((r) => ({ ...r, sector: s.sector })),
      ),
    [filteredSections],
  );

  const viewTotals = useMemo(() => totalsOf(flatRows), [flatRows]);

  const total = flatRows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const sliceFrom = (safePage - 1) * pageSize;
  const slice = flatRows.slice(sliceFrom, sliceFrom + pageSize);
  const fromRow = total === 0 ? 0 : sliceFrom + 1;
  const toRow = Math.min(safePage * pageSize, total);

  const showScope =
    scopeLabel && scopeLabel !== "All parties" && scopeLabel !== "All customers";
  const totalRows = grand.count;

  const exportRows = filteredSections.flatMap((s) =>
    s.rows.map((r) => ({
      Sector: s.sector,
      Code: r.party_code,
      Name: r.name_en,
      City: r.city || "",
      Balance: balanceLabel(r.balance),
      "Balance value": r.balance,
      Rec: "",
      Remarks: "",
    })),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">
            Customer receivables
          </h2>
          <p className="text-sm text-[var(--muted)]">
            {formatReportDate(from)} to {formatReportDate(to)}
            {showScope ? ` · ${scopeLabel}` : ""} · {viewTotals.count}
            {viewTotals.count === 1 ? " shop" : " shops"}
          </p>
        </div>
        <ExportButtons
          rows={exportRows}
          filename={`customer-receivables-${to}`}
        />
      </div>

      <div className="no-print">
        <TableToolbar
          query={localQuery}
          onQueryChange={(value) => {
            setLocalQuery(value);
            setQuery(value);
          }}
          loading={isPending}
          placeholder="Search code, shop, sector..."
          resultCount={total}
          totalCount={totalRows}
        />
      </div>

      {/* Interactive preview — screen only, paginated */}
      <div className="table-shell recovery-balance-shell no-print">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <p className="font-semibold">Outstanding balances</p>
          <p className="text-xs text-[var(--muted)]">
            {total} shops · page {safePage}/{totalPages}
          </p>
        </div>
        <TableScroll loading={isPending}>
          <table className="recovery-balance-table">
            <colgroup>
              <col className="recovery-balance-table__col-sector" />
              <col className="recovery-balance-table__col-code" />
              <col className="recovery-balance-table__col-name" />
              <col className="recovery-balance-table__col-balance" />
              <col className="recovery-balance-table__col-rec" />
              <col className="recovery-balance-table__col-remarks" />
            </colgroup>
            <thead>
              <tr>
                <th>Sector</th>
                <th>Code</th>
                <th>Name</th>
                <th>Balance</th>
                <th>Rec</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {slice.length ? (
                slice.map((r) => (
                  <tr key={r.party_id}>
                    <td className="recovery-balance-table__sector" title={r.sector}>
                      {r.sector}
                    </td>
                    <td className="recovery-balance-table__code">{r.party_code}</td>
                    <td className="recovery-balance-table__name" title={r.name_en}>
                      {r.name_en}
                    </td>
                    <td
                      className={
                        r.balance > 0.005
                          ? "recovery-balance-table__balance font-semibold text-rose-700"
                          : r.balance < -0.005
                            ? "recovery-balance-table__balance font-semibold text-emerald-700"
                            : "recovery-balance-table__balance text-[var(--muted)]"
                      }
                    >
                      {balanceLabel(r.balance)}
                    </td>
                    <td className="recovery-balance-table__rec" />
                    <td className="recovery-balance-table__remarks" />
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[var(--muted)]">
                    No shops match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableScroll>
        <TablePagination
          page={safePage}
          totalPages={totalPages}
          pageSize={pageSize}
          total={total}
          from={fromRow}
          to={toRow}
          loading={isPending}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      {/* Paper-matching Recovery Sheet — print / PDF only (all filtered rows) */}
      <div className="print-only print-sheet recovery-sheet">
        <div className="recovery-sheet-head">
          <div>
            <p className="recovery-sheet-title">Customer receivables</p>
            <p className="recovery-sheet-co">{companyName}</p>
            {showScope ? (
              <p className="recovery-sheet-scope">{scopeLabel}</p>
            ) : null}
          </div>
          <div className="recovery-sheet-dates">
            <p>
              <span>From</span> {formatReportDate(from)}
            </p>
            <p>
              <span>To</span> {formatReportDate(to)}
            </p>
          </div>
        </div>

        {filteredSections.length ? (
          filteredSections.map((section) => {
            const t = totalsOf(section.rows);
            return (
              <section key={section.sector} className="recovery-sheet-section">
                <p className="recovery-sheet-sector">
                  Sector / City: ({section.sector})
                </p>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: "16mm" }}>Code</th>
                      <th>Name</th>
                      <th className="num" style={{ width: "26mm" }}>
                        Balance
                      </th>
                      <th style={{ width: "26mm" }}>Rec</th>
                      <th style={{ width: "34mm" }}>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((r) => (
                      <tr key={r.party_id}>
                        <td>{r.party_code}</td>
                        <td>{r.name_en}</td>
                        <td className="num">{balanceLabel(r.balance)}</td>
                        <td />
                        <td />
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="num" colSpan={2}>
                        {section.sector} — {t.count} shops · Total Dr
                      </td>
                      <td className="num">{formatNumber(t.dueTotal, 0)}</td>
                      <td />
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </section>
            );
          })
        ) : (
          <p style={{ padding: "16px 0", fontSize: 12 }}>
            No shops for this filter.
          </p>
        )}

        <div className="recovery-sheet-foot">
          <span>
            {viewTotals.count} shops · Total due{" "}
            {formatNumber(viewTotals.dueTotal, 0)} Dr · Advance{" "}
            {formatNumber(viewTotals.crTotal, 0)} Cr
          </span>
          <span>Salesman: __________________</span>
        </div>
      </div>
    </div>
  );
}

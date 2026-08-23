"use client";

import { ExportButtons } from "@/components/reports/export-buttons";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { useClientPagination } from "@/hooks/use-client-pagination";
import { formatNumber, formatPkr } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";

function formatCell(key: string, value: unknown) {
  if (value == null || value === "") return "—";
  if (
    typeof value === "number" &&
    /amount|total|paid|profit|cost|rate|discount|subtotal|cash|credit|balance/i.test(
      key,
    )
  ) {
    return formatPkr(value);
  }
  if (typeof value === "number" && /qty/i.test(key)) {
    return formatNumber(value, 3);
  }
  return String(value);
}

function rowFields(
  row: Record<string, unknown>,
  columns: string[],
): DetailField[] {
  return columns.map((c) => ({
    label: c,
    value: formatCell(c, row[c]),
  }));
}

/** A column is numeric if any row carries a number for it. */
function isNumericColumn(rows: Record<string, unknown>[], key: string) {
  return rows.some((r) => typeof r[key] === "number");
}

/** Additive columns get summed in the print totals row (money/qty, not rates). */
function isAdditiveColumn(key: string) {
  return (
    /amount|total|paid|value|balance|qty|cash|credit|debit|profit|subtotal|discount/i.test(
      key,
    ) && !/rate|price|reorder|opening|\bper\b/i.test(key)
  );
}

export function ReportTable({
  title,
  subtitle,
  companyName,
  rows,
  filename,
}: {
  title: string;
  subtitle?: string;
  companyName?: string;
  rows: Record<string, unknown>[];
  filename: string;
}) {
  const [query, setQuery] = useState("");
  const [printedAt, setPrintedAt] = useState("");
  const columns = rows[0] ? Object.keys(rows[0]) : [];

  useEffect(() => {
    setPrintedAt(new Date().toLocaleString());
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      columns.some((c) =>
        String(row[c] ?? "")
          .toLowerCase()
          .includes(q),
      ),
    );
  }, [rows, query, columns]);

  const pager = useClientPagination(filtered);

  const numericCols = useMemo(
    () => new Set(columns.filter((c) => isNumericColumn(filtered, c))),
    [columns, filtered],
  );

  const totals = useMemo(() => {
    const additive = columns.filter(
      (c) => numericCols.has(c) && isAdditiveColumn(c),
    );
    if (!additive.length || !filtered.length) return null;
    const sums: Record<string, number> = {};
    for (const c of additive) {
      sums[c] = filtered.reduce((s, r) => s + Number(r[c] || 0), 0);
    }
    return sums;
  }, [columns, numericCols, filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">
            {title}
          </h2>
          {subtitle ? (
            <p className="text-sm text-[var(--muted)]">{subtitle}</p>
          ) : null}
        </div>
        <ExportButtons rows={filtered} filename={filename} />
      </div>

      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search report rows..."
        resultCount={filtered.length}
        totalCount={rows.length}
      />

      {/* Interactive, paginated table — screen only */}
      <div className="table-shell">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <p className="font-semibold">{title}</p>
          <p className="text-xs text-[var(--muted)]">
            {subtitle || `${filtered.length} rows`} · page {pager.page}/
            {pager.totalPages}
          </p>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
                {columns.length ? (
                  <th className="no-print text-right">Actions</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {pager.slice.length ? (
                pager.slice.map((row, idx) => (
                  <tr key={`${pager.from}-${idx}`}>
                    {columns.map((c) => (
                      <td key={c}>{formatCell(c, row[c])}</td>
                    ))}
                    <td className="no-print">
                      <RowActions
                        viewTitle="Row details"
                        viewFields={rowFields(row, columns)}
                        allowEdit={false}
                        allowDelete={false}
                      />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={Math.max(columns.length + 1, 1)}
                    className="py-8 text-center text-[var(--muted)]"
                  >
                    No rows for this filter. Post transactions or widen the date
                    range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="no-print">
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

      {/* Full report, all filtered rows — print only */}
      <div className="print-only print-sheet report-print">
        <div className="report-print-head">
          <div>
            <p className="report-print-title">{title}</p>
            {companyName ? <p className="report-print-co">{companyName}</p> : null}
          </div>
          <p className="report-print-meta">
            {subtitle ? (
              <>
                {subtitle}
                <br />
              </>
            ) : null}
            {filtered.length} rows{printedAt ? ` · Printed ${printedAt}` : ""}
          </p>
        </div>

        {filtered.length ? (
          <table>
            <thead>
              <tr>
                <th className="num" style={{ width: "10mm" }}>
                  #
                </th>
                {columns.map((c) => (
                  <th key={c} className={numericCols.has(c) ? "num" : undefined}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => (
                <tr key={idx}>
                  <td className="num">{idx + 1}</td>
                  {columns.map((c) => (
                    <td key={c} className={numericCols.has(c) ? "num" : undefined}>
                      {formatCell(c, row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {totals ? (
              <tfoot>
                <tr>
                  <td />
                  {columns.map((c, i) => (
                    <td key={c} className={numericCols.has(c) ? "num" : undefined}>
                      {c in totals
                        ? formatCell(c, totals[c])
                        : i === 0
                          ? "Total"
                          : ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        ) : (
          <p style={{ padding: "16px 0", fontSize: 12 }}>
            No rows for this filter.
          </p>
        )}

        <div className="report-print-foot">
          <span>Umar Distribution Software</span>
          <span>Computer-generated report</span>
        </div>
      </div>
    </div>
  );
}

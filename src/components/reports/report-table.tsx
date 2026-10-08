"use client";

import { PartyRecoveriesManager } from "@/components/recoveries/party-recoveries-manager";
import { PrintOrgCompany } from "@/components/print/print-org-company";
import { PartyBalanceActions } from "@/components/reports/party-balance-actions";
import { ProductReportActions } from "@/components/reports/product-report-actions";
import { ExportButtons } from "@/components/reports/export-buttons";
import { DocumentRowActions } from "@/components/tables/document-row-actions";
import { TableScroll } from "@/components/tables/table-scroll";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { useUrlTableState } from "@/hooks/use-url-table-state";
import { formatNumber, formatPkr } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

function isMetaKey(key: string) {
  return key.startsWith("_");
}

function visibleColumns(row: Record<string, unknown> | undefined) {
  return row ? Object.keys(row).filter((k) => !isMetaKey(k)) : [];
}

function exportRows(rows: Record<string, unknown>[]) {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (!isMetaKey(k)) out[k] = v;
    }
    return out;
  });
}

function formatCell(key: string, value: unknown) {
  if (value == null || value === "") return "—";
  if (
    typeof value === "number" &&
    /amount|total|paid|profit|cost|value|rate|discount|subtotal|cash|credit|balance|salary|expense|recovered|collected|sales|debit/i.test(
      key,
    )
  ) {
    return formatPkr(value);
  }
  if (typeof value === "number" && /\bbills\b|\bcustomers\b/i.test(key)) {
    return formatNumber(value, 0);
  }
  if (typeof value === "number" && /qty/i.test(key)) {
    return formatNumber(value, 3);
  }
  return String(value);
}

const DOCUMENT_HREFS: Array<[RegExp, string]> = [
  [/^\/sales\/invoices\/([^/?#]+)$/i, "sale_invoices"],
  [/^\/purchases\/invoices\/([^/?#]+)$/i, "purchase_invoices"],
  [/^\/sales\/returns\/([^/?#]+)$/i, "sale_returns"],
  [/^\/purchases\/returns\/([^/?#]+)$/i, "purchase_returns"],
  [
    /^\/vouchers\/(?:cash-receipt|cash-payment|journal|expenses)\/([^/?#]+)$/i,
    "vouchers",
  ],
];

function documentFromRow(row: Record<string, unknown>, href?: string) {
  const table = typeof row._doc_table === "string" ? row._doc_table : "";
  const id = typeof row._doc_id === "string" ? row._doc_id : "";
  if (table && id) {
    return {
      table,
      id,
      title: typeof row._doc_title === "string" ? row._doc_title : "Document",
    };
  }
  if (!href) return null;
  for (const [pattern, docTable] of DOCUMENT_HREFS) {
    const match = href.match(pattern);
    if (!match) continue;
    const title =
      row.Invoice || row.Document || row.Narration || row["Inv no."] || "Document";
    return { table: docTable, id: match[1], title: String(title) };
  }
  return null;
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

/** Additive columns get summed in the totals row (money/qty, not rates). */
function isAdditiveColumn(key: string) {
  if (isClosingColumn(key)) return false;
  if (/limit|avg|average|percent|margin|reorder|packing/i.test(key)) return false;
  return (
    /amount|total|paid|value|balance|qty|cash|credit|debit|profit|subtotal|discount|sales|collected|recovered|salary|expense|cost|\bbills\b|\bcustomers\b/i.test(
      key,
    ) && !/rate|price|opening|running|\bper\b|result/i.test(key)
  );
}

/** Running / closing columns: show the last row, never a sum. */
function isClosingColumn(key: string) {
  return /^balance$/i.test(key) || /running/i.test(key);
}

export function ReportTable({
  title,
  subtitle,
  companyName,
  brandName,
  rows,
  filename,
  filters,
  showFooter = true,
}: {
  title: string;
  subtitle?: string;
  companyName?: string;
  brandName?: string | null;
  rows: Record<string, unknown>[];
  filename: string;
  filters?: React.ReactNode;
  /** Opening and closing rows must not be added into a total. */
  showFooter?: boolean;
}) {
  const { page, pageSize, isPending, setPage, setPageSize } =
    useUrlTableState();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [printedAt, setPrintedAt] = useState("");
  const columns = visibleColumns(rows[0]);
  const exportable = useMemo(() => exportRows(rows), [rows]);

  useEffect(() => {
    setPrintedAt(new Date().toLocaleString());
  }, []);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return rows;
    return rows.filter((row) =>
      columns.some((c) =>
        String(row[c] ?? "")
          .toLowerCase()
          .includes(search),
      ),
    );
  }, [rows, query, columns]);

  const filteredExport = useMemo(() => exportRows(filtered), [filtered]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const sliceFrom = (safePage - 1) * pageSize;
  const slice = filtered.slice(sliceFrom, sliceFrom + pageSize);
  const from = total === 0 ? 0 : sliceFrom + 1;
  const to = Math.min(safePage * pageSize, total);

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

  const closingByColumn = useMemo(() => {
    const last = filtered[filtered.length - 1];
    if (!last) return {} as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const c of columns) {
      if (isClosingColumn(c)) out[c] = last[c];
    }
    return out;
  }, [columns, filtered]);

  const showTotals =
    showFooter &&
    (Boolean(totals) || Object.keys(closingByColumn).length > 0);

  function totalsCell(c: string, colIndex: number) {
    if (c in closingByColumn) return formatCell(c, closingByColumn[c]);
    if (totals && c in totals) return formatCell(c, totals[c]);
    if (colIndex === 0) return "Total";
    return "";
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">
            {title}
          </h2>
          {subtitle ? (
            <p className="text-sm text-[var(--muted)]">{subtitle}</p>
          ) : null}
        </div>
        <ExportButtons
          rows={filteredExport.length ? filteredExport : exportable}
          filename={filename}
          title={title}
          printId={filename}
        />
      </div>

      <TableToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search report rows..."
        resultCount={filtered.length}
        totalCount={rows.length}
        filters={filters}
      />

      {/* Interactive, paginated table — screen only */}
      <div className="table-shell">
        <TableScroll loading={isPending}>
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c} className={numericCols.has(c) ? "num" : undefined}>
                    {c}
                  </th>
                ))}
                {columns.length ? (
                  <th className="no-print text-right">Actions</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {slice.length ? (
                slice.map((row, idx) => {
                  const href =
                    typeof row._href === "string" && row._href
                      ? row._href
                      : undefined;
                  const document = documentFromRow(row, href);
                  const recoveryId =
                    typeof row._recovery_id === "string" ? row._recovery_id : "";
                  const companyId =
                    typeof row._company_id === "string" ? row._company_id : "";
                  const organizationId =
                    typeof row._organization_id === "string"
                      ? row._organization_id
                      : "";
                  const partyId =
                    typeof row._party_id === "string" ? row._party_id : "";
                  const partyLabel =
                    typeof row._party_label === "string"
                      ? row._party_label
                      : "Customer";
                  const manageParty = row._party_manage === "1";
                  const manageProduct = row._product_manage === "1";
                  const productId =
                    typeof row._product_id === "string" ? row._product_id : "";
                  const canManageRecovery = Boolean(
                    recoveryId && companyId && partyId,
                  );
                  const expenseId =
                    typeof row._expense_id === "string" ? row._expense_id : "";
                  const fields = rowFields(row, columns);
                  return (
                    <tr key={`${from}-${idx}`}>
                      {columns.map((c) => {
                        const isInv =
                          href &&
                          /^(inv no\.?|invoice)$/i.test(c);
                        return (
                          <td
                            key={c}
                            className={numericCols.has(c) ? "num" : undefined}
                          >
                            {isInv ? (
                              <Link
                                href={href}
                                className="text-[var(--brand)] underline-offset-2 hover:underline"
                              >
                                {formatCell(c, row[c])}
                              </Link>
                            ) : (
                              formatCell(c, row[c])
                            )}
                          </td>
                        );
                      })}
                      <td className="no-print">
                        {document ? (
                          <DocumentRowActions
                            title={document.title}
                            fields={fields}
                            href={href || ""}
                            table={document.table}
                            id={document.id}
                            showPrint={
                              document.table === "sale_invoices" ||
                              document.table === "purchase_invoices"
                            }
                          />
                        ) : manageProduct && productId && companyId && organizationId ? (
                          <ProductReportActions
                            productId={productId}
                            companyId={companyId}
                            organizationId={organizationId}
                            productLabel={
                              typeof row.Product === "string" && row.Product
                                ? `${row.Code ? `${row.Code} — ` : ""}${row.Product}`
                                : "Product"
                            }
                            fields={fields}
                            canEdit={row._can_edit_product !== "0"}
                            canInactivate={row._can_inactivate_product === "1"}
                            canDelete={row._can_delete_product === "1"}
                          />
                        ) : manageParty && partyId && companyId && organizationId ? (
                          <PartyBalanceActions
                            partyId={partyId}
                            companyId={companyId}
                            organizationId={organizationId}
                            partyLabel={
                              typeof row.Name === "string" && row.Name
                                ? `${row.Code ? `${row.Code} — ` : ""}${row.Name}`
                                : partyLabel
                            }
                            fields={fields}
                            canEdit={row._can_edit_party !== "0"}
                            canInactivate={row._can_inactivate === "1"}
                          />
                        ) : expenseId ? (
                          <RowActions
                            viewTitle={String(row["EXP #"] || "Expense")}
                            viewFields={fields}
                            href={href}
                            allowEdit={false}
                            allowDelete
                            deleteTitle={`Delete ${String(row["EXP #"] || "this expense")}?`}
                            deleteDescription="This removes the expense and reverses its ledger entry."
                            deleteConfirmLabel="Delete entry"
                            onDelete={async () => {
                              const supabase = createClient();
                              const { error } = await supabase.rpc("delete_expense", {
                                p_id: expenseId,
                              });
                              if (error) throw new Error(error.message);
                            }}
                          />
                        ) : (
                        <RowActions
                          viewTitle="Row details"
                          viewFields={fields}
                          href={href}
                          printHref={href}
                          editTitle={`Recoveries — ${partyLabel}`}
                          editClassName="sm:max-w-3xl"
                          allowEdit={canManageRecovery}
                          editContent={
                            canManageRecovery
                              ? (close) => (
                                  <PartyRecoveriesManager
                                    companyId={companyId}
                                    partyId={partyId}
                                    partyLabel={partyLabel}
                                    onDone={() => {
                                      close();
                                      router.refresh();
                                    }}
                                  />
                                )
                              : undefined
                          }
                          allowDelete={canManageRecovery}
                          deleteTitle="Delete this recovery?"
                          deleteDescription="The shop balance goes back up by this recovery amount. Use this when the same collection was saved twice."
                          deleteConfirmLabel="Delete entry"
                          onDelete={
                            canManageRecovery
                              ? async () => {
                                  const supabase = createClient();
                                  const { error } = await supabase.rpc(
                                    "cancel_recovery",
                                    { p_recovery_id: recoveryId },
                                  );
                                  if (error) throw new Error(error.message);
                                }
                              : undefined
                          }
                        />
                        )}
                      </td>
                    </tr>
                  );
                })
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
            {showTotals ? (
              <tfoot>
                <tr>
                  {columns.map((c, i) => (
                    <td
                      key={c}
                      className={numericCols.has(c) ? "num font-semibold" : "font-semibold"}
                    >
                      {totalsCell(c, i)}
                    </td>
                  ))}
                  {columns.length ? <td className="no-print" /> : null}
                </tr>
              </tfoot>
            ) : null}
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

      {/* Full report, all filtered rows — print only */}
      <div
        data-print-id={filename}
        className={`print-only print-sheet report-print${
          columns.length > 7 ? " report-print--wide" : ""
        }`}
      >
        <div className="report-print-head">
          <div>
            {brandName ? (
              <>
                <PrintOrgCompany
                  companyName={companyName}
                  brandName={brandName}
                />
                <p className="report-print-title">{title}</p>
              </>
            ) : (
              <>
                <p className="report-print-title">{title}</p>
                {companyName ? (
                  <p className="report-print-co">{companyName}</p>
                ) : null}
              </>
            )}
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
            {showTotals ? (
              <tfoot>
                <tr>
                  <td />
                  {columns.map((c, i) => (
                    <td key={c} className={numericCols.has(c) ? "num" : undefined}>
                      {totalsCell(c, i)}
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

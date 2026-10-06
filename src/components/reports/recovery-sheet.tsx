"use client";

import { ExportButtons } from "@/components/reports/export-buttons";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableScroll } from "@/components/tables/table-scroll";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { PostedDocumentEditor } from "@/components/trading/posted-document-editor";
import { DetailField, RowActions } from "@/components/ui/row-actions";
import { useUrlTableState } from "@/hooks/use-url-table-state";
import type {
  RecoverySheetResult,
  RecoverySheetRow,
  RecoverySheetSection,
} from "@/lib/reports/recovery-data";
import { formatReportDate, formatReportInvNo } from "@/lib/reports/helpers";
import { createClient } from "@/lib/supabase/client";
import { formatNumber, formatPkr } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

const TZ = "Asia/Karachi";

/** Balance → "7,434 Dr" / "1,825 Cr" / "Nil", matching the paper sheet. */
function balanceLabel(balance: number) {
  if (Math.abs(balance) < 0.005) return "Nil";
  if (balance > 0) return `${formatNumber(balance, 2)} Dr`;
  return `${formatNumber(Math.abs(balance), 2)} Cr`;
}

/** Paper sheet amounts — plain numbers, no Dr/Cr suffix. */
function sheetAmount(value: number | null | undefined) {
  if (value == null || Math.abs(value) < 0.005) return "";
  return formatNumber(value, 2);
}

function saleDash(value: string | number | null | undefined) {
  if (value == null || value === "") return "-";
  if (typeof value === "number") {
    if (Math.abs(value) < 0.005) return "-";
    return formatNumber(value, 2);
  }
  return value;
}

/** DD/MM/YY like the printed recovery sheet. */
function formatSheetDate(value: string | null | undefined) {
  if (!value) return "";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function formatPrintedAt(now: Date) {
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: TZ,
  }).format(now);
  const time = new Intl.DateTimeFormat("en-PK", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: TZ,
  }).format(now);
  return { date, time };
}

function formatRangeDate(iso: string) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: TZ,
  }).format(d);
}

type Totals = {
  count: number;
  dueTotal: number;
  crTotal: number;
  finalTotal: number;
  prevTotal: number;
  lastSaleTotal: number;
  lastReceivedTotal: number;
};

type FlatRow = RecoverySheetRow & { sector: string };

function totalsOf(rows: RecoverySheetRow[]): Totals {
  let dueTotal = 0;
  let crTotal = 0;
  let finalTotal = 0;
  let prevTotal = 0;
  let lastSaleTotal = 0;
  let lastReceivedTotal = 0;
  for (const r of rows) {
    finalTotal += r.final_balance;
    prevTotal += Number(r.prev_balance || 0);
    lastSaleTotal += Number(r.last_sale_value || 0);
    lastReceivedTotal += Number(r.last_received_amount || 0);
    if (r.balance > 0.005) dueTotal += r.balance;
    else if (r.balance < -0.005) crTotal += Math.abs(r.balance);
  }
  return {
    count: rows.length,
    dueTotal,
    crTotal,
    finalTotal,
    prevTotal,
    lastSaleTotal,
    lastReceivedTotal,
  };
}

function lastReceivedLabel(amount: number | null | undefined) {
  if (amount == null || amount <= 0.005) return "-";
  return formatNumber(amount, 2);
}

function matchRow(r: RecoverySheetRow, term: string) {
  return [r.party_code, r.name_en, r.city, r.route, r.head, r.last_sale_id]
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
  townLabel = "All Towns",
  salesmanLabel = "All Salesmen",
  sections,
  grand,
  canEdit = true,
}: {
  companyName: string;
  from: string;
  to: string;
  scopeLabel: string;
  townLabel?: string;
  salesmanLabel?: string;
  sections: RecoverySheetSection[];
  grand: RecoverySheetResult["grand"];
  /** View / edit / delete last recovery on each shop row (online). */
  canEdit?: boolean;
}) {
  const router = useRouter();
  const { page, pageSize, isPending, setPage, setPageSize } =
    useUrlTableState();
  const [query, setQuery] = useState("");
  const [printedAt, setPrintedAt] = useState<Date | null>(null);
  const [hideSaleCols, setHideSaleCols] = useState(true);
  const savedTitle = useRef("");

  async function cancelRecovery(id: string) {
    const supabase = createClient();
    const { error } = await supabase.rpc("cancel_recovery", {
      p_recovery_id: id,
    });
    if (error) throw new Error(error.message);
  }

  function rowFields(r: FlatRow): DetailField[] {
    return [
      { label: "Sector", value: r.sector },
      { label: "Acc ID", value: r.party_code },
      { label: "Customer", value: r.name_en },
      { label: "Final bal.", value: balanceLabel(r.final_balance) },
      {
        label: "Last received",
        value:
          r.last_received_amount != null && r.last_received_amount > 0.005
            ? formatPkr(r.last_received_amount)
            : "—",
      },
      {
        label: "Last received date",
        value: r.last_received_date || "—",
      },
      ...(hideSaleCols
        ? []
        : [
            {
              label: "Prev. bal.",
              value: sheetAmount(r.prev_balance) || "—",
            },
            {
              label: "Last sale",
              value: r.last_sale_id
                ? `${formatReportInvNo(r.last_sale_id)} · ${
                    r.last_sale_date
                      ? formatSheetDate(r.last_sale_date)
                      : ""
                  } · ${saleDash(r.last_sale_value)}`
                : "—",
            },
          ]),
    ];
  }

  useEffect(() => {
    setPrintedAt(new Date());
  }, []);

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

  const term = query.trim().toLowerCase();
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

  const exportRows = useMemo(() => {
    const rows = filteredSections.flatMap((s) =>
      s.rows.map((r) => {
        const row: Record<string, unknown> = {
          Sector: s.sector,
          "Acc ID": r.party_code,
          "Customer name": r.name_en,
          "Last received":
            r.last_received_amount != null && r.last_received_amount > 0.005
              ? Number(r.last_received_amount)
              : "",
        };
        if (!hideSaleCols) {
          row["Prev. balance"] = r.prev_balance;
          row["Last sale ID"] = r.last_sale_id || "-";
          row["Last sale"] = r.last_sale_date
            ? formatSheetDate(r.last_sale_date)
            : "-";
          row["Last sale value"] = r.last_sale_value ?? "-";
        }
        row["Final bal."] = r.final_balance;
        row.Received = "";
        row.Remarks = "";
        return row;
      }),
    );
    if (!rows.length) return rows;
    const totalRow: Record<string, unknown> = {
      Sector: "TOTAL",
      "Acc ID": "",
      "Customer name": `${viewTotals.count} shops`,
      "Last received":
        viewTotals.lastReceivedTotal > 0.005
          ? Number(viewTotals.lastReceivedTotal.toFixed(2))
          : "",
    };
    if (!hideSaleCols) {
      totalRow["Prev. balance"] = Number(viewTotals.prevTotal.toFixed(2));
      totalRow["Last sale ID"] = "";
      totalRow["Last sale"] = "";
      totalRow["Last sale value"] = Number(viewTotals.lastSaleTotal.toFixed(2));
    }
    totalRow["Final bal."] = Number(viewTotals.finalTotal.toFixed(2));
    totalRow.Received = "";
    totalRow.Remarks = "";
    return [...rows, totalRow];
  }, [filteredSections, hideSaleCols, viewTotals]);

  const printed = printedAt ? formatPrintedAt(printedAt) : null;

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
          title="Customer receivables"
        />
      </div>

      <div className="no-print">
        <TableToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="Search code, shop, sector..."
          resultCount={total}
          totalCount={totalRows}
          filters={
            <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--ink)]">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-[var(--border)] accent-[var(--brand)]"
                checked={hideSaleCols}
                onChange={(e) => setHideSaleCols(e.target.checked)}
              />
              Hide prev. bal. & last sale
            </label>
          }
        />
      </div>

      {/* Interactive preview — screen only, paginated */}
      <div className="table-shell recovery-balance-shell no-print">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <p className="font-semibold">Customer receivables</p>
          <p className="text-xs text-[var(--muted)]">
            {total} shops · page {safePage}/{totalPages}
          </p>
        </div>
        <TableScroll loading={isPending}>
          <table
            className={
              hideSaleCols
                ? "recovery-balance-table recovery-balance-table--compact"
                : "recovery-balance-table"
            }
          >
            <colgroup>
              <col className="recovery-balance-table__col-sector" />
              <col className="recovery-balance-table__col-code" />
              <col className="recovery-balance-table__col-name" />
              <col className="recovery-balance-table__col-received" />
              {hideSaleCols ? null : (
                <>
                  <col className="recovery-balance-table__col-prev" />
                  <col className="recovery-balance-table__col-sale-id" />
                  <col className="recovery-balance-table__col-sale-date" />
                  <col className="recovery-balance-table__col-sale-value" />
                </>
              )}
              <col className="recovery-balance-table__col-final" />
              <col className="recovery-balance-table__col-rec" />
              <col className="recovery-balance-table__col-remarks" />
              <col className="recovery-balance-table__col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>Sector</th>
                <th>Acc ID</th>
                <th>Customer name</th>
                <th>Last received</th>
                {hideSaleCols ? null : (
                  <>
                    <th>Prev. bal.</th>
                    <th>Last sale ID</th>
                    <th>Last sale</th>
                    <th>Last sale value</th>
                  </>
                )}
                <th>Final bal.</th>
                <th>Received</th>
                <th>Remarks</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {slice.length ? (
                slice.map((r) => {
                  const hasRecovery = Boolean(r.last_received_id);
                  const partyLabel = `${r.party_code} — ${r.name_en}`;
                  return (
                    <tr key={r.party_id}>
                      <td
                        className="recovery-balance-table__sector"
                        title={r.sector}
                      >
                        {r.sector}
                      </td>
                      <td className="recovery-balance-table__code">
                        {r.party_code}
                      </td>
                      <td
                        className="recovery-balance-table__name"
                        title={r.name_en}
                      >
                        {r.name_en}
                      </td>
                      <td
                        className="recovery-balance-table__received"
                        title={lastReceivedLabel(r.last_received_amount)}
                      >
                        {lastReceivedLabel(r.last_received_amount)}
                      </td>
                      {hideSaleCols ? null : (
                        <>
                          <td className="recovery-balance-table__num">
                            {sheetAmount(r.prev_balance)}
                          </td>
                          <td className="recovery-balance-table__sale-id">
                            {r.last_sale_id
                              ? formatReportInvNo(r.last_sale_id)
                              : "-"}
                          </td>
                          <td className="recovery-balance-table__sale-date">
                            {r.last_sale_date
                              ? formatSheetDate(r.last_sale_date)
                              : "-"}
                          </td>
                          <td className="recovery-balance-table__num">
                            {saleDash(r.last_sale_value)}
                          </td>
                        </>
                      )}
                      <td
                        className={
                          r.final_balance > 0.005
                            ? "recovery-balance-table__num font-semibold text-rose-700"
                            : r.final_balance < -0.005
                              ? "recovery-balance-table__num font-semibold text-emerald-700"
                              : "recovery-balance-table__num text-[var(--muted)]"
                        }
                      >
                        {balanceLabel(r.final_balance)}
                      </td>
                      <td className="recovery-balance-table__rec" />
                      <td className="recovery-balance-table__remarks" />
                      <td className="recovery-balance-table__actions">
                        <RowActions
                          viewTitle={
                            hasRecovery
                              ? `Last recovery — ${partyLabel}`
                              : `Shop — ${partyLabel}`
                          }
                          viewFields={rowFields(r)}
                          editTitle={`Edit recovery — ${partyLabel}`}
                          editClassName="sm:max-w-3xl"
                          allowEdit={canEdit && hasRecovery}
                          editContent={
                            canEdit && r.last_received_id
                              ? (close) => (
                                  <PostedDocumentEditor
                                    table="recoveries"
                                    id={r.last_received_id!}
                                    onDone={() => {
                                      close();
                                      router.refresh();
                                    }}
                                  />
                                )
                              : undefined
                          }
                          allowCancel={false}
                          allowDelete={canEdit && hasRecovery}
                          deleteTitle="Delete this recovery?"
                          deleteDescription={
                            hasRecovery
                              ? `Reverse ${formatPkr(Number(r.last_received_amount || 0))} for ${partyLabel}. The customer receivable goes back up by that amount.`
                              : undefined
                          }
                          deleteConfirmLabel="Delete entry"
                          onDelete={
                            r.last_received_id
                              ? () => cancelRecovery(r.last_received_id!)
                              : undefined
                          }
                        />
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td
                    colSpan={hideSaleCols ? 8 : 12}
                    className="py-8 text-center text-[var(--muted)]"
                  >
                    No shops match this filter.
                  </td>
                </tr>
              )}
            </tbody>
            {slice.length ? (
              <tfoot>
                <tr>
                  <td className="font-semibold">Total</td>
                  <td />
                  <td className="text-xs text-[var(--muted)]">
                    {viewTotals.count}{" "}
                    {viewTotals.count === 1 ? "shop" : "shops"}
                  </td>
                  <td className="recovery-balance-table__num font-semibold">
                    {lastReceivedLabel(viewTotals.lastReceivedTotal)}
                  </td>
                  {hideSaleCols ? null : (
                    <>
                      <td className="recovery-balance-table__num font-semibold">
                        {sheetAmount(viewTotals.prevTotal)}
                      </td>
                      <td />
                      <td />
                      <td className="recovery-balance-table__num font-semibold">
                        {saleDash(viewTotals.lastSaleTotal)}
                      </td>
                    </>
                  )}
                  <td
                    className={
                      viewTotals.finalTotal > 0.005
                        ? "recovery-balance-table__num font-semibold text-rose-700"
                        : viewTotals.finalTotal < -0.005
                          ? "recovery-balance-table__num font-semibold text-emerald-700"
                          : "recovery-balance-table__num font-semibold text-[var(--muted)]"
                    }
                  >
                    {balanceLabel(viewTotals.finalTotal)}
                  </td>
                  <td />
                  <td />
                  <td />
                </tr>
              </tfoot>
            ) : null}
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
          <div className="recovery-sheet-head-top">
            <p className="recovery-sheet-title">Customers Receivables</p>
            <p className="recovery-sheet-co">{companyName}</p>
          </div>
          <div className="recovery-sheet-head-body">
            <div className="recovery-sheet-meta">
              <p>
                <span>Town</span>{" "}
                <strong className="recovery-sheet-town">{townLabel}</strong>
              </p>
              <p>
                <span>Salesman</span> {salesmanLabel}
              </p>
            </div>
            <div className="recovery-sheet-dates">
              <p>
                <span>From</span> {formatRangeDate(from)}
                <span className="recovery-sheet-dates__to">To</span>{" "}
                {formatRangeDate(to)}
              </p>
              <p className="recovery-sheet-printed">
                {printed ? `${printed.date} ${printed.time}` : ""}
              </p>
            </div>
          </div>
        </div>

        {filteredSections.length ? (
          filteredSections.map((section) => {
            const t = totalsOf(section.rows);
            return (
              <section key={section.sector} className="recovery-sheet-section">
                <p className="recovery-sheet-sector">{section.sector} Sector</p>
                <table
                  className={
                    hideSaleCols ? "recovery-sheet-table--compact" : undefined
                  }
                >
                  <colgroup>
                    <col className="recovery-sheet__col-id" />
                    <col className="recovery-sheet__col-name" />
                    <col className="recovery-sheet__col-received" />
                    {hideSaleCols ? null : (
                      <>
                        <col className="recovery-sheet__col-prev" />
                        <col className="recovery-sheet__col-sale-id" />
                        <col className="recovery-sheet__col-sale-date" />
                        <col className="recovery-sheet__col-sale-value" />
                      </>
                    )}
                    <col className="recovery-sheet__col-final" />
                    <col className="recovery-sheet__col-rec" />
                    <col className="recovery-sheet__col-remarks" />
                  </colgroup>
                  <thead>
                    <tr>
                      {hideSaleCols ? (
                        <>
                          <th>Acc ID</th>
                          <th>Customer name</th>
                          <th>Last received</th>
                          <th className="num">Final bal.</th>
                          <th>Received</th>
                          <th>Remarks</th>
                        </>
                      ) : (
                        <>
                          <th>
                            Acc
                            <br />
                            ID
                          </th>
                          <th>
                            Customer
                            <br />
                            name
                          </th>
                          <th>
                            Last
                            <br />
                            received
                          </th>
                          <th className="num">
                            Prev.
                            <br />
                            balance
                          </th>
                          <th className="num">
                            Last sale
                            <br />
                            ID
                          </th>
                          <th>
                            Last
                            <br />
                            sale
                          </th>
                          <th className="num">
                            Last sale
                            <br />
                            value
                          </th>
                          <th className="num">
                            Final
                            <br />
                            bal.
                          </th>
                          <th>Received</th>
                          <th>Remarks</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((r) => (
                      <tr key={r.party_id}>
                        <td>{r.party_code}</td>
                        <td className="recovery-sheet__name" title={r.name_en}>
                          {r.name_en}
                        </td>
                        <td className="recovery-sheet__received">
                          {lastReceivedLabel(r.last_received_amount)}
                        </td>
                        {hideSaleCols ? null : (
                          <>
                            <td className="num">{sheetAmount(r.prev_balance)}</td>
                            <td className="num">
                              {r.last_sale_id
                                ? formatReportInvNo(r.last_sale_id)
                                : "-"}
                            </td>
                            <td>
                              {r.last_sale_date
                                ? formatSheetDate(r.last_sale_date)
                                : "-"}
                            </td>
                            <td className="num">{saleDash(r.last_sale_value)}</td>
                          </>
                        )}
                        <td className="num">{sheetAmount(r.final_balance)}</td>
                        <td />
                        <td />
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2} className="num">
                        {section.sector} — {t.count} shops
                      </td>
                      <td className="num">
                        {lastReceivedLabel(t.lastReceivedTotal)}
                      </td>
                      {hideSaleCols ? null : (
                        <>
                          <td className="num">{sheetAmount(t.prevTotal)}</td>
                          <td />
                          <td />
                          <td className="num">
                            {saleDash(t.lastSaleTotal)}
                          </td>
                        </>
                      )}
                      <td className="num">{formatNumber(t.finalTotal, 2)}</td>
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
            {viewTotals.count} shops · Last received total{" "}
            {formatNumber(viewTotals.lastReceivedTotal, 2)} · Final bal. total{" "}
            {formatNumber(viewTotals.finalTotal, 2)}
          </span>
          <span>Salesman: __________________</span>
        </div>
      </div>
    </div>
  );
}

"use client";

import { ExportButtons } from "@/components/reports/export-buttons";
import { TableToolbar } from "@/components/tables/table-toolbar";
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
  const [query, setQuery] = useState("");
  const savedTitle = useRef("");

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

  // Filter sections by the on-screen search; the print sheet renders exactly
  // what is shown here so a filtered search prints a filtered sheet.
  const view = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = term
      ? sections
          .map((s) => ({ ...s, rows: s.rows.filter((r) => matchRow(r, term)) }))
          .filter((s) => s.rows.length)
      : sections;
    const flat = filtered.flatMap((s) => s.rows);
    return { sections: filtered, totals: totalsOf(flat) };
  }, [sections, query]);

  const showScope =
    scopeLabel && scopeLabel !== "All parties" && scopeLabel !== "All customers";
  const totalRows = grand.count;

  const exportRows = view.sections.flatMap((s) =>
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
            {showScope ? ` · ${scopeLabel}` : ""} · {view.totals.count}
            {view.totals.count === 1 ? " shop" : " shops"}
          </p>
        </div>
        <ExportButtons
          rows={exportRows}
          filename={`customer-receivables-${to}`}
        />
      </div>

      <div className="no-print">
        <TableToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="Search code, shop, sector..."
          resultCount={view.totals.count}
          totalCount={totalRows}
        />
      </div>

      {/* Interactive preview — screen only */}
      <div className="table-shell no-print">
        {view.sections.length ? (
          view.sections.map((section) => (
            <div key={section.sector}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-2">
                <p className="text-sm font-semibold uppercase tracking-wide">
                  Sector: {section.sector}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {section.count} shops · Due{" "}
                  {formatNumber(
                    totalsOf(section.rows).dueTotal,
                    0,
                  )}
                </p>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: "12%" }}>Code</th>
                      <th>Name</th>
                      <th style={{ width: "18%" }}>Balance</th>
                      <th style={{ width: "14%" }}>Rec</th>
                      <th style={{ width: "20%" }}>Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((r) => (
                      <tr key={r.party_id}>
                        <td className="font-medium">{r.party_code}</td>
                        <td>{r.name_en}</td>
                        <td
                          className={
                            r.balance > 0.005
                              ? "font-semibold text-rose-700"
                              : r.balance < -0.005
                                ? "font-semibold text-emerald-700"
                                : "text-[var(--muted)]"
                          }
                        >
                          {balanceLabel(r.balance)}
                        </td>
                        <td />
                        <td />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        ) : (
          <p className="py-8 text-center text-[var(--muted)]">
            No shops match this filter.
          </p>
        )}
      </div>

      {/* Paper-matching Recovery Sheet — print / PDF only */}
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

        {view.sections.length ? (
          view.sections.map((section) => {
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
            {view.totals.count} shops · Total due{" "}
            {formatNumber(view.totals.dueTotal, 0)} Dr · Advance{" "}
            {formatNumber(view.totals.crTotal, 0)} Cr
          </span>
          <span>Salesman: __________________</span>
        </div>
      </div>
    </div>
  );
}

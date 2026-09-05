import { ExportButtons } from "@/components/reports/export-buttons";
import {
  formatReportNumber,
  formatReportRange,
} from "@/lib/reports/helpers";

type PartyGroup = {
  id: string;
  name: string;
  line: string;
  rows: Record<string, unknown>[];
  qty: number;
  amount: number;
};

function groupByParty(rows: Record<string, unknown>[]): PartyGroup[] {
  const groups: PartyGroup[] = [];
  const index = new Map<string, number>();

  for (const row of rows) {
    const id = String(row._party_id || row._party_name || "unknown");
    let i = index.get(id);
    if (i == null) {
      i = groups.length;
      index.set(id, i);
      groups.push({
        id,
        name: String(row._party_name || "Unknown"),
        line: String(row._party_line || ""),
        rows: [],
        qty: 0,
        amount: 0,
      });
    }
    groups[i].rows.push(row);
    groups[i].qty += Number(row.Qty || 0);
    groups[i].amount += Number(row.Amount || 0);
  }

  return groups;
}

function formatPrice(value: number) {
  return Number.isInteger(value)
    ? formatReportNumber(value, 0)
    : formatReportNumber(value, 2);
}

function exportRows(rows: Record<string, unknown>[]) {
  return rows.map((row) => {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!key.startsWith("_")) next[key] = value;
    }
    return next;
  });
}

function TotalBoxes({
  label,
  qty,
  amount,
  report,
}: {
  label: string;
  qty: number;
  amount: number;
  report?: boolean;
}) {
  return (
    <tr className={report ? "classic-report-grand" : "classic-report-party-total"}>
      <td colSpan={4} className="classic-report-total-label">
        {label}
      </td>
      <td className="classic-report-num">
        <span className={report ? "classic-report-double" : "classic-report-box"}>
          {formatReportNumber(qty)}
        </span>
      </td>
      <td />
      <td className="classic-report-num">
        <span className={report ? "classic-report-double" : "classic-report-box"}>
          {formatReportNumber(amount)}
        </span>
      </td>
    </tr>
  );
}

export function PartyWiseSalesPrint({
  companyName,
  from,
  to,
  rows,
  filename,
}: {
  companyName: string;
  from: string;
  to: string;
  rows: Record<string, unknown>[];
  filename: string;
}) {
  const groups = groupByParty(rows);
  const reportQty = groups.reduce((s, g) => s + g.qty, 0);
  const reportAmount = groups.reduce((s, g) => s + g.amount, 0);

  return (
    <div className="space-y-3">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">
            Item, Customer Wise Sales Detail
          </h2>
          <p className="text-sm text-[var(--muted)]">
            {companyName} · {formatReportRange(from, to)} · {rows.length} lines
          </p>
        </div>
        <ExportButtons
          rows={exportRows(rows)}
          filename={filename}
          title="Item, Customer Wise Sales Detail"
        />
      </div>

      {!groups.length ? (
        <p className="no-print rounded-lg border border-dashed border-[var(--border)] bg-white px-4 py-6 text-center text-sm text-[var(--muted)]">
          No posted sale lines for this filter. Post invoices or widen the date
          range.
        </p>
      ) : null}

      <div
        className={
          groups.length
            ? "print-sheet classic-report"
            : "print-only print-sheet classic-report"
        }
      >
        <div className="classic-report-head">
          <p className="classic-report-title">Item, Customer Wise Sales Detail</p>
          <p className="classic-report-dates">{formatReportRange(from, to)}</p>
        </div>

        {groups.length ? (
          groups.map((group, gi) => (
            <section key={group.id} className="classic-report-party-block">
              <p className="classic-report-party">{group.name}</p>
              {group.line ? (
                <p className="classic-report-party-line">{group.line}</p>
              ) : null}

              <table>
                <colgroup>
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "7%" }} />
                  <col style={{ width: "7%" }} />
                  <col style={{ width: "32%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "16%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Inv No.</th>
                    <th>Item No</th>
                    <th>ItemName</th>
                    <th className="classic-report-num">Qty</th>
                    <th className="classic-report-num">Price</th>
                    <th className="classic-report-num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row, idx) => (
                    <tr
                      key={`${group.id}-${idx}`}
                      className={
                        idx === group.rows.length - 1
                          ? "classic-report-last-data"
                          : undefined
                      }
                    >
                      <td>{String(row.Date || "")}</td>
                      <td>{String(row["Inv No."] || "")}</td>
                      <td>{String(row["Item No"] || "")}</td>
                      <td>{String(row.ItemName || "")}</td>
                      <td className="classic-report-num">
                        {formatReportNumber(Number(row.Qty || 0))}
                      </td>
                      <td className="classic-report-num">
                        {formatPrice(Number(row.Price || 0))}
                      </td>
                      <td className="classic-report-num">
                        {formatReportNumber(Number(row.Amount || 0))}
                      </td>
                    </tr>
                  ))}
                  <TotalBoxes
                    label="Customer Total ="
                    qty={group.qty}
                    amount={group.amount}
                  />
                  {gi === groups.length - 1 ? (
                    <TotalBoxes
                      label="Report Total ="
                      qty={reportQty}
                      amount={reportAmount}
                      report
                    />
                  ) : null}
                </tbody>
              </table>
            </section>
          ))
        ) : (
          <p className="py-4 text-center text-sm text-[var(--muted)]">
            No posted sale lines for this filter.
          </p>
        )}
      </div>
    </div>
  );
}

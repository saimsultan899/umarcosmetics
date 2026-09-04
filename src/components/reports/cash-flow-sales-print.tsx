import { ExportButtons } from "@/components/reports/export-buttons";
import {
  formatReportNumber,
  formatReportRange,
} from "@/lib/reports/helpers";
import { formatPkr } from "@/lib/utils";
import Link from "next/link";

type InvoiceRow = {
  date: string;
  invNo: string;
  type: string;
  saleAmount: number;
  cash: number;
  credit: number;
  href: string;
};

type PartyGroup = {
  id: string;
  rank: number;
  code: string;
  name: string;
  amount: number;
  invoices: InvoiceRow[];
};

type CompanyGroup = {
  name: string;
  amount: number;
  parties: PartyGroup[];
};

function groupCashFlow(rows: Record<string, unknown>[]): CompanyGroup[] {
  const companies = new Map<
    string,
    {
      name: string;
      amount: number;
      parties: Map<string, PartyGroup>;
    }
  >();

  for (const row of rows) {
    const companyName = String(row._company || "Unknown");
    let company = companies.get(companyName);
    if (!company) {
      company = {
        name: companyName,
        amount: Number(row._company_amount || 0),
        parties: new Map(),
      };
      companies.set(companyName, company);
    }

    const partyId = String(row._party_id || "unknown");
    let party = company.parties.get(partyId);
    if (!party) {
      party = {
        id: partyId,
        rank: Number(row._party_rank || 0),
        code: String(row._party_code || ""),
        name: String(row._party_name || "Unknown"),
        amount: Number(row._party_amount || 0),
        invoices: [],
      };
      company.parties.set(partyId, party);
    }

    party.invoices.push({
      date: String(row.Date || ""),
      invNo: String(row["Inv No."] || ""),
      type: String(row.Type || ""),
      saleAmount: Number(row["Sale amount"] || 0),
      cash: Number(row["Cash received"] || 0),
      credit: Number(row["Credit balance"] || 0),
      href: String(row._href || ""),
    });
  }

  return [...companies.values()]
    .map((c) => ({
      name: c.name,
      amount: c.amount,
      parties: [...c.parties.values()].sort((a, b) => a.rank - b.rank),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function exportRows(rows: Record<string, unknown>[]) {
  return rows.map((row) => ({
    Company: row._company,
    Rank: row._party_rank,
    "Customer code": row._party_code,
    Customer: row._party_name,
    Date: row.Date,
    "Inv No.": row["Inv No."],
    Type: row.Type,
    "Sale amount": row["Sale amount"],
    "Cash received": row["Cash received"],
    "Credit balance": row["Credit balance"],
  }));
}

/**
 * Cash flow (sales): each brand/company with top customers by sale amount,
 * and their invoices (cash vs credit split).
 */
export function CashFlowSalesPrint({
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
  const groups = groupCashFlow(rows);
  const reportSale = groups.reduce((s, g) => s + g.amount, 0);
  const reportCash = rows.reduce(
    (s, r) => s + Number(r["Cash received"] || 0),
    0,
  );
  const reportCredit = rows.reduce(
    (s, r) => s + Number(r["Credit balance"] || 0),
    0,
  );

  return (
    <div className="space-y-3">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold">
            Cash flow (sales) — company top customers
          </h2>
          <p className="text-sm text-[var(--muted)]">
            {companyName} · {formatReportRange(from, to)} · {groups.length}{" "}
            {groups.length === 1 ? "company" : "companies"} · {rows.length}{" "}
            invoices
          </p>
        </div>
        <ExportButtons rows={exportRows(rows)} filename={filename} />
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
            ? "print-sheet classic-report cash-flow-report"
            : "print-only print-sheet classic-report cash-flow-report"
        }
      >
        <div className="classic-report-head">
          <p className="classic-report-title">
            Cash flow (sales) — company top customers
          </p>
          <p className="classic-report-dates">{formatReportRange(from, to)}</p>
        </div>

        {groups.length ? (
          <>
            {groups.map((company) => (
              <section key={company.name} className="classic-report-party-block">
                <div className="cash-flow-company-head">
                  <p className="classic-report-party">{company.name}</p>
                  <p className="cash-flow-company-total">
                    Company sale {formatPkr(company.amount)} ·{" "}
                    {company.parties.length} top{" "}
                    {company.parties.length === 1 ? "customer" : "customers"}
                  </p>
                </div>

                {company.parties.map((party) => (
                  <div key={party.id} className="cash-flow-party-block">
                    <p className="cash-flow-party-head">
                      <span className="cash-flow-rank">#{party.rank}</span>{" "}
                      {[party.code, party.name].filter(Boolean).join(" — ")}
                      <span className="cash-flow-party-amt">
                        {formatPkr(party.amount)}
                      </span>
                    </p>

                    <table>
                      <colgroup>
                        <col style={{ width: "14%" }} />
                        <col style={{ width: "14%" }} />
                        <col style={{ width: "12%" }} />
                        <col style={{ width: "20%" }} />
                        <col style={{ width: "20%" }} />
                        <col style={{ width: "20%" }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Inv No.</th>
                          <th>Type</th>
                          <th className="classic-report-num">Sale amount</th>
                          <th className="classic-report-num">Cash received</th>
                          <th className="classic-report-num">Credit balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {party.invoices.map((inv, idx) => (
                          <tr
                            key={`${party.id}-${inv.invNo}-${idx}`}
                            className={
                              idx === party.invoices.length - 1
                                ? "classic-report-last-data"
                                : undefined
                            }
                          >
                            <td>{inv.date}</td>
                            <td>
                              {inv.href ? (
                                <Link
                                  href={`${inv.href}?print=1`}
                                  className="text-[var(--brand)] underline-offset-2 hover:underline"
                                >
                                  {inv.invNo}
                                </Link>
                              ) : (
                                inv.invNo
                              )}
                            </td>
                            <td>{inv.type}</td>
                            <td className="classic-report-num">
                              {formatReportNumber(inv.saleAmount)}
                            </td>
                            <td className="classic-report-num">
                              {formatReportNumber(inv.cash)}
                            </td>
                            <td className="classic-report-num">
                              {formatReportNumber(inv.credit)}
                            </td>
                          </tr>
                        ))}
                        <tr className="classic-report-party-total">
                          <td colSpan={3} className="classic-report-total-label">
                            Customer total =
                          </td>
                          <td className="classic-report-num">
                            <span className="classic-report-box">
                              {formatReportNumber(party.amount)}
                            </span>
                          </td>
                          <td className="classic-report-num">
                            <span className="classic-report-box">
                              {formatReportNumber(
                                party.invoices.reduce((s, i) => s + i.cash, 0),
                              )}
                            </span>
                          </td>
                          <td className="classic-report-num">
                            <span className="classic-report-box">
                              {formatReportNumber(
                                party.invoices.reduce(
                                  (s, i) => s + i.credit,
                                  0,
                                ),
                              )}
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ))}

                <p className="cash-flow-company-foot">
                  {company.name} total = {formatPkr(company.amount)}
                </p>
              </section>
            ))}

            <div className="cash-flow-report-total">
              <span>Report total =</span>
              <span>
                Sale {formatPkr(reportSale)} · Cash {formatPkr(reportCash)} ·
                Credit {formatPkr(reportCredit)}
              </span>
            </div>
          </>
        ) : (
          <p className="py-4 text-center text-sm text-[var(--muted)]">
            No posted sale lines for this filter.
          </p>
        )}
      </div>
    </div>
  );
}

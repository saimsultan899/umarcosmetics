import { PrintOrgCompany } from "@/components/print/print-org-company";
import { ExportButtons } from "@/components/reports/export-buttons";
import { ReportSectionHead } from "@/components/reports/report-section-head";
import {
  formatReportDate,
  formatReportNumber,
  formatReportRange,
} from "@/lib/reports/helpers";
import { formatPkr } from "@/lib/utils";
import Link from "next/link";

type InvoiceRow = {
  date: string;
  invNo: string;
  product: string;
  qty: number;
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
  qty: number;
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
        qty: Number(row._party_qty || 0),
        invoices: [],
      };
      company.parties.set(partyId, party);
    }

    party.invoices.push({
      date: String(row.Date || ""),
      invNo: String(row["Inv No."] || ""),
      product: String(row.Product || ""),
      qty: Number(row.Qty || 0),
      type: String(row.Type || ""),
      saleAmount: Number(row["Sale amount"] || 0),
      cash: Number(row["Cash received"] || 0),
      credit: Number(row["Credit balance"] || 0),
      href: String(row._href || ""),
    });
    if (!party.qty) {
      party.qty = party.invoices.reduce((sum, line) => sum + line.qty, 0);
    }
  }

  return [...companies.values()]
    .map((c) => ({
      name: c.name,
      amount: c.amount,
      parties: [...c.parties.values()].sort((a, b) => a.rank - b.rank),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function compactPrintDate(value: string) {
  const match = value.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!match) return value;
  const month: Record<string, string> = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12",
  };
  return `${match[1]}/${month[match[2]] || match[2]}/${match[3].slice(2)}`;
}

function productNameOnly(label: string) {
  const parts = label.split(" — ");
  return (parts.length > 1 ? parts.slice(1).join(" — ") : label).trim();
}

function exportRows(rows: Record<string, unknown>[]) {
  return rows.map((row) => ({
    Company: row._company,
    Rank: row._party_rank,
    "Customer code": row._party_code,
    Customer: row._party_name,
    Date: row.Date,
    "Inv No.": row["Inv No."],
    Product: row.Product,
    Qty: row.Qty,
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
  brandName,
  from,
  to,
  rows,
  filename,
}: {
  companyName: string;
  brandName?: string | null;
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
  const reportQty = rows.reduce((s, r) => s + Number(r.Qty || 0), 0);
  const productNames = [
    ...new Set(rows.map((r) => String(r.Product || "").trim()).filter(Boolean)),
  ];
  const productTitle =
    productNames.length === 1
      ? productNameOnly(productNames[0])
      : productNames.length > 1
        ? `${productNames.length} items`
        : "";

  return (
    <div className="space-y-3">
      <ReportSectionHead
        className="no-print"
        title="Cash flow (sales) — company top customers"
        subtitle={`${companyName} · ${formatReportRange(from, to)}${
          productTitle ? ` · ${productTitle}` : ""
        } · ${groups.length} ${
          groups.length === 1 ? "company" : "companies"
        } · ${rows.length} lines`}
        actions={
          <ExportButtons
            rows={exportRows(rows)}
            filename={filename}
            title="Cash flow (company top customers)"
            printId={filename}
          />
        }
      />

      {!groups.length ? (
        <p className="no-print rounded-lg border border-dashed border-[var(--border)] bg-white px-4 py-6 text-center text-sm text-[var(--muted)]">
          No posted sale lines for this filter. Post invoices or widen the date
          range.
        </p>
      ) : null}

      <div
        data-print-id={filename}
        className={
          groups.length
            ? "print-sheet classic-report cash-flow-report"
            : "print-only print-sheet classic-report cash-flow-report"
        }
      >
        <div className="classic-report-head">
          <div>
            <PrintOrgCompany
              companyName={companyName}
              brandName={brandName}
            />
            <p className="classic-report-title">
              Cash flow (sales) — company top customers
              {productTitle ? ` · ${productTitle}` : ""}
            </p>
          </div>
          <p className="classic-report-dates">
            {compactPrintDate(formatReportDate(from))} To{" "}
            {compactPrintDate(formatReportDate(to))}
          </p>
        </div>

        {groups.length ? (
          <>
            {groups.map((company) => (
              <section key={company.name} className="classic-report-party-block">
                <div className="cash-flow-company-head">
                  <p className="classic-report-party">{company.name}</p>
                  <p className="cash-flow-company-total">
                    {(() => {
                      const names = [
                        ...new Set(
                          company.parties
                            .flatMap((p) => p.invoices.map((i) => i.product))
                            .filter(Boolean),
                        ),
                      ];
                      const itemLabel =
                        names.length === 1
                          ? productNameOnly(names[0])
                          : names.length > 1
                            ? `${names.length} items`
                            : "";
                      const qty = company.parties.reduce((s, p) => s + p.qty, 0);
                      return [
                        itemLabel ? `Item ${itemLabel}` : "",
                        `Company sale ${formatPkr(company.amount)}`,
                        `Qty ${formatReportNumber(qty, 0)}`,
                        `${company.parties.length} top ${
                          company.parties.length === 1 ? "customer" : "customers"
                        }`,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                    })()}
                  </p>
                </div>

                {company.parties.map((party) => {
                  const productNames = [
                    ...new Set(party.invoices.map((i) => i.product).filter(Boolean)),
                  ];
                  const showProduct = productNames.length > 1;
                  return (
                  <div key={party.id} className="cash-flow-party-block">
                    <p className="cash-flow-party-head">
                      <span className="cash-flow-rank">#{party.rank}</span>{" "}
                      {[party.code, party.name].filter(Boolean).join(" — ")}
                      <span className="cash-flow-party-amt">
                        {formatPkr(party.amount)}
                        {party.qty ? ` · qty ${formatReportNumber(party.qty, 0)}` : ""}
                      </span>
                    </p>

                    <table>
                      <colgroup>
                        <col className="cash-flow-col-date" />
                        <col className="cash-flow-col-inv" />
                        {showProduct ? <col className="cash-flow-col-product" /> : null}
                        <col className="cash-flow-col-qty" />
                        <col className="cash-flow-col-type" />
                        <col />
                        <col />
                        <col />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Inv No.</th>
                          {showProduct ? <th>Product</th> : null}
                          <th className="classic-report-num">Qty</th>
                          <th>Type</th>
                          <th className="classic-report-num">Sale amount</th>
                          <th className="classic-report-num">Cash received</th>
                          <th className="classic-report-num">Credit balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {party.invoices.map((inv, idx) => (
                          <tr key={`${party.id}-${inv.invNo}-${inv.product}-${idx}`}>
                            <td className="cash-flow-date">{compactPrintDate(inv.date)}</td>
                            <td className="cash-flow-inv">
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
                            {showProduct ? (
                              <td>{productNameOnly(inv.product) || "—"}</td>
                            ) : null}
                            <td className="classic-report-num">
                              {formatReportNumber(inv.qty, 0)}
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
                      </tbody>
                    </table>
                    <table className="classic-report-totals">
                      <colgroup>
                        <col className="cash-flow-col-date" />
                        <col className="cash-flow-col-inv" />
                        {showProduct ? <col className="cash-flow-col-product" /> : null}
                        <col className="cash-flow-col-qty" />
                        <col className="cash-flow-col-type" />
                        <col />
                        <col />
                        <col />
                      </colgroup>
                      <tbody>
                        <tr className="classic-report-party-total">
                          <td
                            colSpan={showProduct ? 3 : 2}
                            className="classic-report-total-label"
                          >
                            Customer total =
                          </td>
                          <td className="classic-report-num">
                            <span className="classic-report-box">
                              {formatReportNumber(party.qty, 0)}
                            </span>
                          </td>
                          <td />
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
                  );
                })}

                <p className="cash-flow-company-foot">
                  {company.name} total = {formatPkr(company.amount)}
                </p>
              </section>
            ))}

            <div className="cash-flow-report-total">
              <span>Report total =</span>
              <span>
                Sale {formatPkr(reportSale)} · Qty {formatReportNumber(reportQty, 0)} ·
                Cash {formatPkr(reportCash)} · Credit {formatPkr(reportCredit)}
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

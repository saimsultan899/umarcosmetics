"use client";

import { Button } from "@/components/ui/button";
import { installDesktopPrint } from "@/lib/desktop-print";
import {
  A4_INVOICE_LINES_PER_PAGE,
  A5_INVOICE_LINES_PER_PAGE,
  chunkLines,
  preferredInvoicePaper,
} from "@/lib/print/invoice-paper";
import { printWithAutoPaper } from "@/lib/print/paper-size";
import { formatReportInvNo } from "@/lib/reports/helpers";
import { cn, formatNumber } from "@/lib/utils";
import { Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export type PrintLine = {
  product_code: string;
  product_name: string;
  /** Brand / stock company shown before ItemName when present. */
  company?: string | null;
  qty: number;
  bonus?: number;
  /** Pack / unit label e.g. Carton, Piece */
  uom?: string | null;
  packing?: number;
  unit_type?: string | null;
  base_unit?: string | null;
  rate?: number;
  /** Line discount amount (rupees). Displayed as % of qty×rate. */
  discount?: number;
  amount?: number;
};

function lineDiscPercent(qty: number, rate: number, discount: number) {
  const gross = qty * rate;
  if (gross <= 0 || discount <= 0) return 0;
  return Math.round((discount / gross) * 1000) / 10;
}

/** Qty expressed as cartons from packing, e.g. 100 ÷ 200 → 0.5 */
function formatCartonQty(qty: number, packing: number) {
  if (!(packing > 1)) return "—";
  return formatNumber(qty / packing, 2);
}

function formatPrintDate(iso: string) {
  // Keep ISO date as-is if already YYYY-MM-DD; otherwise format.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-CA");
}

function formatPrintTime(isoDateTime?: string | null) {
  if (!isoDateTime) return "";
  const d = new Date(isoDateTime);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export type PrintMeta = { label: string; value: string; strong?: boolean };

/**
 * Generic document print — classic distributor layout shared by purchase
 * invoices, sales/purchase returns, transfers, load sheets and vouchers.
 * A5/A4 line counts and auto page-shift match sale invoice print.
 */
export function PrintDocument({
  companyName,
  companyAddress,
  companyNtn,
  companyPhone,
  title,
  docNo,
  date,
  printedAt,
  partyName,
  partyCode,
  partyAddress,
  partyCity,
  partyPhone,
  partyMobile,
  warehouseName,
  extraMeta,
  lines,
  totals,
  amountInWords,
  signatures,
  footerNote,
  size = "full",
  autoPrint = false,
  showLineSummary = true,
}: {
  companyName: string;
  companyAddress?: string | null;
  companyNtn?: string | null;
  companyPhone?: string | null;
  title: string;
  docNo: string;
  date: string;
  /** Invoice created_at — shown as time next to date. */
  printedAt?: string | null;
  partyName?: string | null;
  partyCode?: string | null;
  partyAddress?: string | null;
  partyCity?: string | null;
  partyPhone?: string | null;
  /** Shop / customer mobile. Shown with the owner number. */
  partyMobile?: string | null;
  warehouseName?: string | null;
  extraMeta?: PrintMeta[];
  lines: PrintLine[];
  totals?: PrintMeta[];
  amountInWords?: string | null;
  signatures?: string[];
  footerNote?: string | null;
  /** @deprecated Prefer A5/A4 toggle; full=a4, half=a5 as initial hint only. */
  size?: "full" | "half";
  autoPrint?: boolean;
  /** Products / Total qty rows above money totals. Off for purchase invoices. */
  showLineSummary?: boolean;
}) {
  const [paperTouched, setPaperTouched] = useState(false);
  const [paper, setPaper] = useState<"a5" | "a4">(() => {
    // Legacy half hint only when the bill still fits A5.
    if (size === "half" && lines.length <= A5_INVOICE_LINES_PER_PAGE) {
      return "a5";
    }
    return preferredInvoicePaper(lines.length);
  });

  useEffect(() => {
    if (paperTouched) return;
    setPaper(preferredInvoicePaper(lines.length));
  }, [lines.length, paperTouched]);

  const useFullA4 = paper === "a4";
  const linesPerPage = useFullA4
    ? A4_INVOICE_LINES_PER_PAGE
    : A5_INVOICE_LINES_PER_PAGE;

  const sheetPages = useMemo(() => {
    const chunks = chunkLines(lines, linesPerPage);
    return chunks.map((pageLines, idx) => ({
      pageLines,
      startIndex: idx * linesPerPage,
      isFirst: idx === 0,
      isLast: idx === chunks.length - 1,
    }));
  }, [lines, linesPerPage]);

  useEffect(() => {
    installDesktopPrint();
    if (!autoPrint) return;
    const t = window.setTimeout(() => {
      printWithAutoPaper(paper);
    }, 250);
    return () => window.clearTimeout(t);
  }, [autoPrint, paper]);

  function choosePaper(next: "a5" | "a4") {
    setPaperTouched(true);
    setPaper(next);
  }

  function printNow() {
    printWithAutoPaper(paper);
  }

  const productCount = lines.length;
  const totalQty = lines.reduce(
    (sum, line) => sum + Number(line.qty || 0) + Number(line.bonus || 0),
    0,
  );
  const hasRate = lines.some((l) => l.rate != null);
  /** Show Disc. column whenever any line includes a discount field (incl. 0). */
  const hasDiscount = lines.some((l) => l.discount != null);
  const hasAmount = lines.some((l) => l.amount != null);
  const hasUom = lines.some(
    (l) => l.uom || (l.packing != null && Number(l.packing) > 1),
  );
  const hasLineCompany = lines.some((l) => Boolean(l.company));

  const dateTimeLabel = [formatPrintDate(date), formatPrintTime(printedAt)]
    .filter(Boolean)
    .join(" ");

  const itemNameWidth = (() => {
    let used = 5; // Sr
    if (hasLineCompany) used += 11;
    used += 7; // Qty
    if (hasUom) used += 7;
    if (hasRate) used += 8;
    if (hasDiscount) used += 5 + 5; // Disc % + Disc — keep narrow
    if (hasAmount) used += 14;
    return `${Math.max(40, 100 - used)}%`;
  })();

  function renderTable(pageLines: PrintLine[], startIndex: number) {
    return (
      <table className="si-table">
        <colgroup>
          <col style={{ width: "5%" }} />
          {hasLineCompany ? <col style={{ width: "11%" }} /> : null}
          <col style={{ width: itemNameWidth }} />
          <col style={{ width: "7%" }} />
          {hasUom ? <col style={{ width: "7%" }} /> : null}
          {hasRate ? <col style={{ width: "8%" }} /> : null}
          {hasDiscount ? <col style={{ width: "5%" }} /> : null}
          {hasDiscount ? <col style={{ width: "5%" }} /> : null}
          {hasAmount ? <col style={{ width: "14%" }} /> : null}
        </colgroup>
        <thead>
          <tr>
            <th className="ctr">Sr.</th>
            {hasLineCompany ? <th>Company</th> : null}
            <th>ItemName</th>
            <th className="num">Qty</th>
            {hasUom ? <th className="ctr">Carton</th> : null}
            {hasRate ? <th className="num">T/P</th> : null}
            {hasDiscount ? <th className="num">Disc %</th> : null}
            {hasDiscount ? <th className="num">Disc</th> : null}
            {hasAmount ? <th className="num">Amount</th> : null}
          </tr>
        </thead>
        <tbody>
          {pageLines.map((l, i) => {
            const packing = Number(l.packing || 0);
            const cartonValue =
              packing > 1
                ? formatCartonQty(l.qty, packing)
                : l.uom || l.base_unit || l.unit_type || "—";
            const sr = startIndex + i + 1;
            return (
              <tr key={`${l.product_code}-${sr}`}>
                <td className="ctr">{sr}</td>
                {hasLineCompany ? <td>{l.company || "—"}</td> : null}
                <td className="si-item">
                  {[l.product_code, l.product_name].filter(Boolean).join(" ")}
                </td>
                <td className="num">
                  <div>{formatNumber(l.qty, 2)}</div>
                  {l.bonus && l.bonus > 0 ? (
                    <div className="si-bonus">
                      +{formatNumber(l.bonus, 0)} B
                    </div>
                  ) : null}
                </td>
                {hasUom ? <td className="ctr">{cartonValue}</td> : null}
                {hasRate ? (
                  <td className="num">
                    {l.rate != null ? formatNumber(l.rate, 2) : "—"}
                  </td>
                ) : null}
                {hasDiscount ? (
                  <td className="num">
                    {(() => {
                      const pct = lineDiscPercent(
                        Number(l.qty || 0),
                        Number(l.rate || 0),
                        Number(l.discount || 0),
                      );
                      return pct > 0 ? `${formatNumber(pct, 1)}%` : "—";
                    })()}
                  </td>
                ) : null}
                {hasDiscount ? (
                  <td className="num">
                    {l.discount ? formatNumber(l.discount, 2) : "—"}
                  </td>
                ) : null}
                {hasAmount ? (
                  <td className="num">
                    {l.amount != null ? formatNumber(l.amount, 2) : "—"}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto text-sm text-[var(--muted)]">
          {useFullA4
            ? `A4 · up to ${A4_INVOICE_LINES_PER_PAGE} lines per page, then next A4 page.`
            : `A5 · up to ${A5_INVOICE_LINES_PER_PAGE} lines per page, then next page. Over ${A5_INVOICE_LINES_PER_PAGE} lines auto-selects A4.`}
        </p>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-white p-0.5">
          <button
            type="button"
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-semibold",
              paper === "a5"
                ? "bg-[var(--brand)] text-white"
                : "text-[var(--muted)] hover:text-[var(--ink)]",
            )}
            onClick={() => choosePaper("a5")}
          >
            A5
          </button>
          <button
            type="button"
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-semibold",
              paper === "a4"
                ? "bg-[var(--brand)] text-white"
                : "text-[var(--muted)] hover:text-[var(--ink)]",
            )}
            onClick={() => choosePaper("a4")}
            title={`A4 · ${A4_INVOICE_LINES_PER_PAGE} lines/page (auto when over ${A5_INVOICE_LINES_PER_PAGE} lines)`}
          >
            A4
          </button>
        </div>
        <Button type="button" onClick={printNow}>
          <Printer className="h-4 w-4" />
          Print
        </Button>
      </div>

      <div
        className={cn(
          "print-sheet cdoc mx-auto",
          useFullA4 ? "cdoc--a4" : "cdoc--half",
        )}
        data-paper={useFullA4 ? "a4" : "a5"}
      >
        {sheetPages.map((page, pageIdx) => (
          <div
            key={pageIdx}
            className={cn(
              useFullA4 ? "si-sale-a4-chunk" : "si-sale-a5-chunk",
              pageIdx < sheetPages.length - 1 &&
                (useFullA4
                  ? "si-sale-a4-page-break"
                  : "si-sale-a5-page-break"),
            )}
          >
            {page.isFirst ? (
              <>
                <div className="si-title">{title}</div>
                {companyName ? (
                  <div className="si-company">{companyName}</div>
                ) : null}
                {companyAddress ? (
                  <div className="si-distributor-addr">{companyAddress}</div>
                ) : null}
                {companyPhone || companyNtn ? (
                  <div className="si-distributor-addr">
                    {[
                      companyPhone,
                      companyNtn ? `NTN/STRN: ${companyNtn}` : "",
                    ]
                      .filter(Boolean)
                      .join("  ·  ")}
                  </div>
                ) : null}

                <div className="si-meta">
                  <div className="si-meta-left">
                    {partyName ? (
                      <div>
                        <span className="si-k">A/C No :</span>{" "}
                        <span className="si-v">
                          {String(partyCode || "").toUpperCase() === "WALKIN"
                            ? partyName || "Walk-in Customer"
                            : [partyCode, partyName]
                                .filter(Boolean)
                                .join(" ")}
                        </span>
                      </div>
                    ) : null}
                    {partyAddress ? (
                      <div className="si-co">{partyAddress}</div>
                    ) : null}
                    {partyCity ? (
                      <div className="si-co">{partyCity}</div>
                    ) : null}
                    {partyMobile ? (
                      <div>
                        <span className="si-k">Cust Mob No:</span>{" "}
                        <span className="si-v">{partyMobile}</span>
                      </div>
                    ) : null}
                    {partyPhone ? (
                      <div>
                        <span className="si-k">Owner No:</span>{" "}
                        <span className="si-v">{partyPhone}</span>
                      </div>
                    ) : null}
                  </div>
                  <div className="si-meta-right si-meta-block">
                    <div>
                      <span className="si-k">No :</span>{" "}
                      <span className="si-v">
                        {formatReportInvNo(docNo) || docNo}
                      </span>
                    </div>
                    <div>
                      <span className="si-k">Date :</span>{" "}
                      <span className="si-v">{dateTimeLabel}</span>
                    </div>
                    {warehouseName ? (
                      <div>
                        <span className="si-k">Company:</span>{" "}
                        <span className="si-v">{warehouseName}</span>
                      </div>
                    ) : null}
                    {(extraMeta ?? []).map((m) => (
                      <div key={m.label} className="si-meta-nowrap">
                        <span className="si-k">{m.label}:</span>{" "}
                        <span className="si-v">{m.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="si-cont">
                <span className="si-k">No :</span>{" "}
                <span className="si-v">
                  {formatReportInvNo(docNo) || docNo}
                </span>
                <span className="si-cont-page">
                  · Page {pageIdx + 1} of {sheetPages.length}
                </span>
              </div>
            )}

            <div
              className={cn(
                page.isLast &&
                  sheetPages.length > 1 &&
                  (useFullA4
                    ? "si-sale-a4-last-chunk"
                    : "si-sale-a5-last-chunk"),
              )}
            >
              {renderTable(page.pageLines, page.startIndex)}

              {page.isLast ? (
                <>
                  <div className="cdoc-totals">
                    {showLineSummary ? (
                      <>
                        <div className="si-row">
                          <span>Products</span>
                          <span>{formatNumber(productCount, 0)}</span>
                        </div>
                        <div className="si-row">
                          <span>Total qty</span>
                          <span>{formatNumber(totalQty, 0)}</span>
                        </div>
                      </>
                    ) : null}
                    {totals?.map((t, i) => {
                      const anyStrong = totals.some((x) => x.strong);
                      const isGrand =
                        t.strong ??
                        (!anyStrong && i === totals.length - 1);
                      return (
                        <div
                          key={t.label}
                          className={cn("si-row", isGrand && "si-strong")}
                        >
                          <span>{t.label}</span>
                          <span>{t.value}</span>
                        </div>
                      );
                    })}
                  </div>

                  {amountInWords ? (
                    <p className="cdoc-words">
                      <b>Amount in words:</b> {amountInWords}
                    </p>
                  ) : null}

                  {signatures?.length ? (
                    <div className="cdoc-sign-row">
                      {signatures.map((s) => (
                        <div key={s}>{s}</div>
                      ))}
                    </div>
                  ) : null}

                  <p className="cdoc-foot">
                    {footerNote ||
                      "This is a computer-generated document · Umar Distribution Software"}
                  </p>
                </>
              ) : null}
            </div>
          </div>
        ))}

        <div className="doc-cut">
          ✂ — — — — — — — — — — cut here — — — — — — — — — —
        </div>
      </div>
    </div>
  );
}

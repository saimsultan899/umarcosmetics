"use client";

import { Button } from "@/components/ui/button";
import { installDesktopPrint } from "@/lib/desktop-print";
import {
  useClientReady,
  useSlipQuery,
  useWalkInSlip,
  writeWalkInSlip,
  type WalkInSlipLayout,
} from "@/lib/print/walk-in-slip";
import {
  holdThermalZeroMargin,
  printThermalSlip,
} from "@/lib/print/thermal-page";
import { printWithAutoPaper, warmPrintCss } from "@/lib/print/paper-size";
import { formatReportInvNo } from "@/lib/reports/helpers";
import { cn, formatNumber, formatPkr } from "@/lib/utils";
import { ArrowLeft, Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

/** A5 sale invoice: this many product lines per page; extra lines continue on the next A5 page. */
export const A5_SALE_LINES_PER_PAGE = 28;
/**
 * A4 sale invoice: more than 40 product lines on one A4 page (header/footer included).
 * Overflow continues on the next A4 page. Bills with more than A5 capacity auto-prefer A4.
 */
export const A4_SALE_LINES_PER_PAGE = 45;

function chunkLines<T>(items: T[], size: number): T[][] {
  if (items.length <= size) return [items];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}

function preferredSalePaper(lineCount: number): "a5" | "a4" {
  return lineCount > A5_SALE_LINES_PER_PAGE ? "a4" : "a5";
}

/** Default A5/A4 sale columns — compact for normal bills. */
const SALE_COLS_NORMAL = ["4%", "40%", "7%", "11%", "8%", "9%", "8%", "13%"] as const;
/** Wider money columns when any T/P, Disc, or Amount hits 6+ digits. */
const SALE_COLS_WIDE = ["4%", "30%", "7%", "9%", "10%", "8%", "14%", "18%"] as const;

function hasSixDigitMoney(lines: SalePrintLine[]): boolean {
  for (const l of lines) {
    for (const v of [l.tradePrice, l.discount, l.amount]) {
      if (Math.floor(Math.abs(Number(v) || 0)) >= 100_000) return true;
    }
  }
  return false;
}

export type SalePrintLine = {
  product_code?: string | null;
  product_name: string;
  qty: number;
  bonus?: number;
  scheme?: string | null;
  tradePrice: number;
  discount: number;
  amount: number;
};

const THERMAL_DASH = "--------------------------------";
const THERMAL_EQ = "================================";

function itemLabel(_code?: string | null, name?: string | null) {
  const label = String(name || "").trim();
  return label || "—";
}

/** Extra owner numbers — only for Umar Group sale invoices. */
const UMAR_GROUP_OWNER_PHONES = ["0300-6765266", "0307-7842100"];

function isUmarGroupOrg(organizationName?: string | null): boolean {
  return String(organizationName || "")
    .trim()
    .toLowerCase() === "umar group";
}

/** Header phones: company settings for all; Umar Group also appends owner numbers. */
function distributorPhoneLines(
  companyPhone?: string | null,
  organizationName?: string | null,
): string[] {
  const fromCompany = String(companyPhone || "")
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const merged = [...fromCompany];
  if (isUmarGroupOrg(organizationName)) {
    for (const n of UMAR_GROUP_OWNER_PHONES) {
      if (!merged.includes(n)) merged.push(n);
    }
  }
  return merged;
}

function discPercent(qty: number, tradePrice: number, discount: number) {
  const gross = qty * tradePrice;
  if (gross <= 0 || discount <= 0) return 0;
  return Math.round((discount / gross) * 1000) / 10;
}

function formatDateLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTimeLabel(isoDateTime?: string | null) {
  if (!isoDateTime) return "";
  const d = new Date(isoDateTime);
  if (Number.isNaN(d.getTime())) return "";
  const t = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return t.replace(/\s([ap]m)$/i, "\u00a0$1");
}

/** Print scheme with a leading + when it's a free/bonus qty (e.g. 1 → +1). */
function formatSchemeLabel(scheme?: string | null, bonus?: number) {
  const raw = scheme?.trim();
  if (raw) {
    if (
      raw.startsWith("+") ||
      /\d+\s*\+\s*\d+/.test(raw) ||
      raw.includes("%") ||
      /rs|₨/i.test(raw)
    ) {
      return raw;
    }
    if (/^\d+(\.\d+)?$/.test(raw)) return `+${raw}`;
    return raw;
  }
  if (bonus && bonus > 0) return `+${formatNumber(bonus, 0)}`;
  return null;
}

/**
 * Half-A4 sale invoice print — matches classic distributor bill layout
 * (Sr / Item / Qty / Trade Price / Disc% / Disc Val / Amount + dual footer).
 */
export function SaleInvoicePrint({
  companyName,
  companyPhone: _companyPhone,
  organizationName = null,
  docNo,
  date,
  printedAt,
  partyCode,
  partyName,
  partyOwner,
  partyPhone,
  partyMobile,
  sector,
  salesmanLabel: _salesmanLabel,
  lines,
  subtotal,
  tradeDiscount,
  extraDiscount = 0,
  billAmount,
  paid = 0,
  paymentType = "credit",
  previousPayment = 0,
  previousBalance,
  creditDays = 21,
  preparedBy = null,
  autoPrint = false,
  isWalkIn = false,
  companyId = "",
  embedded = false,
  forceStandard = false,
  /** Controlled paper size when embedded in batch print. */
  paperSize: paperSizeProp,
}: {
  companyName: string;
  companyPhone?: string | null;
  /** When "Umar Group", owner phones are appended under the company name. */
  organizationName?: string | null;
  docNo: string;
  date: string;
  /** Invoice created_at — used for time on the bill. */
  printedAt?: string | null;
  partyCode?: string | null;
  partyName?: string | null;
  partyOwner?: string | null;
  partyPhone?: string | null;
  partyMobile?: string | null;
  sector?: string | null;
  salesmanLabel?: string | null;
  lines: SalePrintLine[];
  subtotal: number;
  tradeDiscount: number;
  extraDiscount?: number;
  billAmount: number;
  /** Cash received against this invoice (counter). */
  paid?: number;
  /** cash | credit | partial */
  paymentType?: string;
  /** Last recovery on this shop (receivable) — never this bill's cash. */
  previousPayment?: number;
  previousBalance: number;
  creditDays?: number;
  preparedBy?: string | null;
  autoPrint?: boolean;
  /** Cash counter sale with no ledger (party code WALKIN). */
  isWalkIn?: boolean;
  companyId?: string;
  /** Hide chrome — used inside batch print (one toolbar for all). */
  embedded?: boolean;
  /** Always use standard sheet (no thermal) — safest for batch print. */
  forceStandard?: boolean;
  /** a5 (default half slip) or a4 (full page when many lines). */
  paperSize?: "a5" | "a4";
}) {
  const router = useRouter();
  const paidOnBill = Math.max(0, paid);
  const type = String(paymentType || "credit").toLowerCase();
  const showCounterCash =
    (type === "cash" || type === "partial") && paidOnBill > 0.005;
  const billPayable = Math.max(0, billAmount - paidOnBill);
  const totalPayable = billPayable + previousBalance;
  const prevLabel =
    previousBalance === 0
      ? "0.00"
      : `${formatNumber(Math.abs(previousBalance), 2)} ${previousBalance >= 0 ? "Dr" : "Cr"}`;

  const customerNo = (partyMobile || "").trim();
  const ownerNo = (partyPhone || "").trim();
  const dateTimeLabel = [formatDateLabel(date), formatTimeLabel(printedAt)]
    .filter(Boolean)
    .join(" ");
  const headerPhones = distributorPhoneLines(_companyPhone, organizationName);
  const preparedByLabel = String(preparedBy || "").trim();

  const savedTitle = useRef("");
  const clientReady = useClientReady();
  const savedDefault = useWalkInSlip(companyId);
  const urlSlip = useSlipQuery();
  const [manualLayout, setManualLayout] = useState<WalkInSlipLayout | null>(null);
  const [paperTouched, setPaperTouched] = useState(false);
  const [localPaper, setLocalPaper] = useState<"a5" | "a4">(() =>
    preferredSalePaper(lines.length),
  );
  const layout = manualLayout ?? urlSlip ?? savedDefault;
  const showSheet = !isWalkIn || clientReady || forceStandard || embedded;
  const showThermal =
    !forceStandard &&
    !embedded &&
    isWalkIn &&
    clientReady &&
    layout === "thermal";
  const sheetPaper = paperSizeProp ?? localPaper;
  const useFullA4 = !showThermal && sheetPaper === "a4";
  const linesPerPage = useFullA4
    ? A4_SALE_LINES_PER_PAGE
    : A5_SALE_LINES_PER_PAGE;

  const sheetPages = useMemo(() => {
    const chunks = chunkLines(lines, linesPerPage);
    return chunks.map((pageLines, idx) => ({
      pageLines,
      startIndex: idx * linesPerPage,
      isFirst: idx === 0,
      isLast: idx === chunks.length - 1,
    }));
  }, [lines, linesPerPage]);

  const saleColWidths = useMemo(
    () => (hasSixDigitMoney(lines) ? SALE_COLS_WIDE : SALE_COLS_NORMAL),
    [lines],
  );

  useEffect(() => {
    if (embedded || paperSizeProp) return;
    try {
      const raw = new URLSearchParams(window.location.search).get("paper");
      if (raw === "a4" || raw === "a5") {
        setLocalPaper(raw);
        setPaperTouched(true);
        return;
      }
    } catch {
      /* ignore */
    }
  }, [embedded, paperSizeProp]);

  useEffect(() => {
    if (embedded || paperSizeProp || paperTouched) return;
    setLocalPaper(preferredSalePaper(lines.length));
  }, [embedded, paperSizeProp, paperTouched, lines.length]);

  function choosePaper(next: "a5" | "a4") {
    setPaperTouched(true);
    setLocalPaper(next);
  }

  useEffect(() => {
    if (embedded) return;
    installDesktopPrint();
    const idle = window.requestIdleCallback?.bind(window);
    if (idle) {
      const id = idle(() => warmPrintCss());
      return () => window.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(() => warmPrintCss(), 200);
    return () => window.clearTimeout(timer);
  }, [embedded]);

  useEffect(() => {
    if (!showThermal) return;
    return holdThermalZeroMargin();
  }, [showThermal]);

  function printCurrent() {
    if (showThermal) {
      printThermalSlip(
        document.querySelector<HTMLElement>(".print-sheet.thermal-80"),
      );
      return;
    }
    printWithAutoPaper(sheetPaper);
  }

  useEffect(() => {
    if (embedded) return;
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
  }, [embedded]);

  useEffect(() => {
    if (embedded) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "p") return;
      if (!showSheet) return;
      event.preventDefault();
      if (showThermal) {
        printThermalSlip(
          document.querySelector<HTMLElement>(".print-sheet.thermal-80"),
        );
        return;
      }
      printWithAutoPaper(sheetPaper);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [embedded, showThermal, showSheet, sheetPaper]);

  useEffect(() => {
    if (embedded || !autoPrint || !showSheet) return;
    const t = window.setTimeout(() => {
      if (showThermal) {
        printThermalSlip(
          document.querySelector<HTMLElement>(".print-sheet.thermal-80"),
        );
        return;
      }
      printWithAutoPaper(sheetPaper);
    }, 300);
    return () => window.clearTimeout(t);
  }, [embedded, autoPrint, showSheet, showThermal, sheetPaper]);

  function setWalkInDefault(next: WalkInSlipLayout) {
    if (!companyId) return;
    writeWalkInSlip(companyId, next);
    setManualLayout(null);
  }

  return (
    <div className={embedded ? "batch-sale-print-item" : "space-y-4"}>
      {!embedded ? (
        <div className="no-print flex flex-wrap items-center justify-end gap-2">
          <p className="mr-auto text-sm text-[var(--muted)]">
            {showThermal
              ? "80mm thermal · walk-in cash slip"
              : useFullA4
                ? `A4 · up to ${A4_SALE_LINES_PER_PAGE} lines per page, then next A4 page.`
                : isWalkIn
                  ? savedDefault === "thermal"
                    ? "Standard invoice for this bill. Next walk-in still uses the thermal slip."
                    : `A5 · up to ${A5_SALE_LINES_PER_PAGE} lines per page, then next page.`
                  : `A5 · up to ${A5_SALE_LINES_PER_PAGE} lines per page, then next page. Over ${A5_SALE_LINES_PER_PAGE} lines auto-selects A4.`}
          </p>
          {isWalkIn ? (
            <label className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--brand)]"
                checked={savedDefault === "thermal"}
                onChange={(e) =>
                  setWalkInDefault(e.target.checked ? "thermal" : "standard")
                }
              />
              Thermal default for walk-in
            </label>
          ) : null}
          {isWalkIn && showThermal ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setManualLayout("standard")}
            >
              Standard invoice
            </Button>
          ) : null}
          {isWalkIn && !showThermal ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setManualLayout("thermal")}
            >
              Thermal receipt
            </Button>
          ) : null}
          {!showThermal ? (
            <div className="inline-flex rounded-lg border border-[var(--border)] bg-white p-0.5">
              <button
                type="button"
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-semibold",
                  sheetPaper === "a5"
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
                  sheetPaper === "a4"
                    ? "bg-[var(--brand)] text-white"
                    : "text-[var(--muted)] hover:text-[var(--ink)]",
                )}
                onClick={() => choosePaper("a4")}
                title={`A4 · ${A4_SALE_LINES_PER_PAGE} lines/page (auto when over ${A5_SALE_LINES_PER_PAGE} lines)`}
              >
                A4
              </button>
            </div>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) {
                router.back();
              } else {
                router.push("/sales/invoices");
              }
            }}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Button type="button" onClick={printCurrent}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>
      ) : null}

      {showSheet && showThermal ? (
        <div className="print-sheet thermal-80 mx-auto" data-paper="thermal">
          <div className="th-shop">{companyName || "Sale"}</div>
          {headerPhones.length > 0 ? (
            <div className="th-sub">{headerPhones.join("  ")}</div>
          ) : null}
          <div className="th-eq">{THERMAL_EQ}</div>
          <div className="th-center th-strong">CASH SALE</div>
          <div className="th-center">{partyName || "Walk-in Customer"}</div>
          <div className="th-meta">
            <span>Bill {formatReportInvNo(docNo) || docNo}</span>
            <span>{dateTimeLabel}</span>
          </div>
          <div className="th-dash">{THERMAL_DASH}</div>
          <table className="th-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Qty</th>
                <th className="num">Rate</th>
                <th className="num">Amt</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const schemeLabel = formatSchemeLabel(l.scheme, l.bonus);
                return (
                  <tr key={`${l.product_code || l.product_name}-${i}`}>
                    <td>
                      {itemLabel(l.product_code, l.product_name)}
                      {schemeLabel ? (
                        <span className="th-scheme"> {schemeLabel}</span>
                      ) : null}
                    </td>
                    <td className="num">{formatNumber(l.qty, 2)}</td>
                    <td className="num">{formatNumber(l.tradePrice, 2)}</td>
                    <td className="num">{formatNumber(l.amount, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="th-dash">{THERMAL_DASH}</div>
          <div className="th-row">
            <span>Total</span>
            <span>{formatNumber(subtotal, 2)}</span>
          </div>
          {tradeDiscount > 0 ? (
            <div className="th-row">
              <span>Trade discount</span>
              <span>{formatNumber(tradeDiscount, 2)}</span>
            </div>
          ) : null}
          {extraDiscount > 0 ? (
            <div className="th-row">
              <span>Extra discount</span>
              <span>{formatNumber(extraDiscount, 2)}</span>
            </div>
          ) : null}
          <div className="th-row th-total">
            <span>BILL AMOUNT</span>
            <span>{formatPkr(billAmount)}</span>
          </div>
          {showCounterCash ? (
            <div className="th-row">
              <span>Cash received</span>
              <span>{formatNumber(paidOnBill, 2)}</span>
            </div>
          ) : null}
          {showCounterCash && billPayable > 0.005 ? (
            <div className="th-row th-strong">
              <span>Balance</span>
              <span>{formatNumber(billPayable, 2)}</span>
            </div>
          ) : null}
          <div className="th-eq">{THERMAL_EQ}</div>
          <div className="th-thanks">Thank you</div>
          <div className="th-credit">
            <div className="th-credit-line">
              {preparedByLabel
                ? `Prepared By : ${preparedByLabel}`
                : "Prepared By : —"}
            </div>
            <div className="th-credit-line">
              Developed by Umar Distributor (0308-4882425, 03006031380)
            </div>
          </div>
          {/* Exactly 2 line feeds before the cutter — not 4+. */}
          <div className="th-cut-feed" aria-hidden="true" />
        </div>
      ) : null}

      {showSheet && !showThermal ? (
        <div
          className={cn(
            "print-sheet mx-auto",
            useFullA4 ? "si-a4" : "si-half",
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
                  <div className="si-head">
                    <div className="si-doc-label">Sale Invoice</div>
                    {companyName ? (
                      <div className="si-title">{companyName}</div>
                    ) : (
                      <div className="si-title">Sale Invoice</div>
                    )}
                    {headerPhones.length > 0 ? (
                      <div className="si-company-line si-company-phones">
                        {headerPhones.join("   ")}
                      </div>
                    ) : null}
                  </div>

                  <div className="si-meta">
                    <div className="si-meta-left si-meta-block">
                      <div className="si-party-ac">
                        <span className="si-k">A/C No :</span>{" "}
                        <span className="si-v">
                          {String(partyCode || "").toUpperCase() === "WALKIN"
                            ? partyName || "Walk-in Customer"
                            : [partyCode, partyName].filter(Boolean).join(" ")}
                        </span>
                      </div>
                      {partyOwner ? (
                        <div>
                          <span className="si-k">OWNER:</span>{" "}
                          <span className="si-v">{partyOwner}</span>
                        </div>
                      ) : null}
                      {customerNo ? (
                        <div>
                          <span className="si-k">Cust Mob No:</span>{" "}
                          <span className="si-v">{customerNo}</span>
                        </div>
                      ) : null}
                      {ownerNo ? (
                        <div>
                          <span className="si-k">Owner No:</span>{" "}
                          <span className="si-v">{ownerNo}</span>
                        </div>
                      ) : null}
                      <div className="si-meta-nowrap">
                        <span className="si-k">Date :</span>{" "}
                        <span className="si-v">{dateTimeLabel}</span>
                      </div>
                    </div>
                    <div className="si-meta-right si-meta-block">
                      <div>
                        <span className="si-k">Bill No :</span>{" "}
                        <span className="si-v">
                          {formatReportInvNo(docNo) || docNo}
                        </span>
                      </div>
                      {sector ? (
                        <div>
                          <span className="si-k">Sector:</span>{" "}
                          <span className="si-v">{sector}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : null}

              {page.isLast ? (
                <div
                  className={cn(
                    sheetPages.length > 1 &&
                      (useFullA4
                        ? "si-sale-a4-last-chunk"
                        : "si-sale-a5-last-chunk"),
                  )}
                >
                  {!page.isFirst ? (
                    <div className="si-cont">
                      <span className="si-k">Bill No :</span>{" "}
                      <span className="si-v">
                        {formatReportInvNo(docNo) || docNo}
                      </span>
                      <span className="si-cont-page">
                        · Page {pageIdx + 1} of {sheetPages.length}
                      </span>
                    </div>
                  ) : null}
                  <table className="si-table">
                    <colgroup>
                      {saleColWidths.map((w, i) => (
                        <col key={i} style={{ width: w }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        <th className="ctr">Sr.</th>
                        <th>ItemName</th>
                        <th className="num">Qty</th>
                        <th className="num">Scheme</th>
                        <th className="num">T/P</th>
                        <th className="num">Disc %</th>
                        <th className="num">Disc</th>
                        <th className="num">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.pageLines.map((l, i) => {
                        const sr = page.startIndex + i + 1;
                        const pct = discPercent(l.qty, l.tradePrice, l.discount);
                        const schemeLabel = formatSchemeLabel(l.scheme, l.bonus);
                        return (
                          <tr key={`${l.product_code || l.product_name}-${sr}`}>
                            <td className="ctr">{sr}</td>
                            <td
                              className="si-item"
                              title={itemLabel(l.product_code, l.product_name)}
                            >
                              {itemLabel(l.product_code, l.product_name)}
                            </td>
                            <td className="num">{formatNumber(l.qty, 2)}</td>
                            <td className="num">{schemeLabel || "—"}</td>
                            <td className="num">
                              {formatNumber(l.tradePrice, 2)}
                            </td>
                            <td className="num">
                              {pct > 0 ? `${formatNumber(pct, 1)} %` : "—"}
                            </td>
                            <td className="num">
                              {l.discount > 0
                                ? formatNumber(l.discount, 2)
                                : "—"}
                            </td>
                            <td className="num">{formatNumber(l.amount, 2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div className="si-foot">
                  <div className="si-foot-col si-foot-bill">
                    <div className="si-row">
                      <span>Total</span>
                      <span>{formatNumber(subtotal, 2)}</span>
                    </div>
                    <div className="si-row">
                      <span>Less Trade Discount</span>
                      <span>{formatNumber(tradeDiscount, 2)}</span>
                    </div>
                    <div className="si-row">
                      <span>Less Extra Discount</span>
                      <span>{formatNumber(extraDiscount, 2)}</span>
                    </div>
                    <div className="si-row si-strong">
                      <span>Bill Amount</span>
                      <span>{formatNumber(billAmount, 2)}</span>
                    </div>
                    <p className="si-note" lang="ur">
                      سابقہ بل کی ادائیگی پر نئی انوائس دی جائے گی۔
                    </p>
                    {preparedByLabel ? (
                      <div className="si-prepared">
                        Prepared By : {preparedByLabel}
                      </div>
                    ) : null}
                  </div>

                  <div className="si-foot-col si-foot-pay">
                    <div className="si-row">
                      <span>Last Paid Amount</span>
                      <span>{formatNumber(previousPayment, 2)}</span>
                    </div>
                    {showCounterCash ? (
                      <div className="si-row">
                        <span>Counter Cash Paid</span>
                        <span>{formatNumber(paidOnBill, 2)}</span>
                      </div>
                    ) : null}
                    <div className="si-row">
                      <span>Bill Payable</span>
                      <span>{formatNumber(billPayable, 2)}</span>
                    </div>
                    <div className="si-row">
                      <span>Previous Balance</span>
                      <span>{prevLabel}</span>
                    </div>
                    <div className="si-row si-strong">
                      <span>Total Payable</span>
                      <span>{formatPkr(totalPayable)}</span>
                    </div>
                    <div className="si-checked">
                      Checked By.
                      <span className="si-sign-line" />
                    </div>
                  </div>
                  <div className="si-developed">
                    Developed by Umar Distributor (0308-4882425, 03006031380)
                  </div>
                </div>
                </div>
              ) : (
                <table className="si-table">
                  <colgroup>
                    {saleColWidths.map((w, i) => (
                      <col key={i} style={{ width: w }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="ctr">Sr.</th>
                      <th>ItemName</th>
                      <th className="num">Qty</th>
                      <th className="num">Scheme</th>
                      <th className="num">T/P</th>
                      <th className="num">Disc %</th>
                      <th className="num">Disc</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.pageLines.map((l, i) => {
                      const sr = page.startIndex + i + 1;
                      const pct = discPercent(l.qty, l.tradePrice, l.discount);
                      const schemeLabel = formatSchemeLabel(l.scheme, l.bonus);
                      return (
                        <tr key={`${l.product_code || l.product_name}-${sr}`}>
                          <td className="ctr">{sr}</td>
                          <td
                            className="si-item"
                            title={itemLabel(l.product_code, l.product_name)}
                          >
                            {itemLabel(l.product_code, l.product_name)}
                          </td>
                          <td className="num">{formatNumber(l.qty, 2)}</td>
                          <td className="num">{schemeLabel || "—"}</td>
                          <td className="num">{formatNumber(l.tradePrice, 2)}</td>
                          <td className="num">
                            {pct > 0 ? `${formatNumber(pct, 1)} %` : "—"}
                          </td>
                          <td className="num">
                            {l.discount > 0 ? formatNumber(l.discount, 2) : "—"}
                          </td>
                          <td className="num">{formatNumber(l.amount, 2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

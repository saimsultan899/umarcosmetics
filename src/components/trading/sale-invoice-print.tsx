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
import { printThermalSlip } from "@/lib/print/thermal-page";
import { printWithAutoPaper } from "@/lib/print/paper-size";
import { formatReportInvNo } from "@/lib/reports/helpers";
import { formatNumber, formatPkr } from "@/lib/utils";
import { ArrowLeft, Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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

function itemLabel(code?: string | null, name?: string | null) {
  return [code, name].filter(Boolean).join(" ");
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
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
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
  preparedBy,
  autoPrint = false,
  isWalkIn = false,
  companyId = "",
}: {
  companyName: string;
  companyPhone?: string | null;
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

  const savedTitle = useRef("");
  const clientReady = useClientReady();
  const savedDefault = useWalkInSlip(companyId);
  const urlSlip = useSlipQuery();
  const [manualLayout, setManualLayout] = useState<WalkInSlipLayout | null>(null);
  const layout = manualLayout ?? urlSlip ?? savedDefault;
  const showSheet = !isWalkIn || clientReady;
  const showThermal = isWalkIn && clientReady && layout === "thermal";

  useEffect(() => {
    installDesktopPrint();
  }, []);

  function printCurrent() {
    if (showThermal) {
      printThermalSlip(
        document.querySelector<HTMLElement>(".print-sheet.thermal-80"),
      );
      return;
    }
    printWithAutoPaper("a5");
  }

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

  useEffect(() => {
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
      printWithAutoPaper("a5");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [showThermal, showSheet]);

  useEffect(() => {
    if (!autoPrint || !showSheet) return;
    const t = window.setTimeout(() => {
      if (showThermal) {
        printThermalSlip(
          document.querySelector<HTMLElement>(".print-sheet.thermal-80"),
        );
        return;
      }
      printWithAutoPaper("a5");
    }, 300);
    return () => window.clearTimeout(t);
  }, [autoPrint, showSheet, showThermal]);

  function setWalkInDefault(next: WalkInSlipLayout) {
    if (!companyId) return;
    writeWalkInSlip(companyId, next);
    setManualLayout(null);
  }

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto text-sm text-[var(--muted)]">
          {showThermal
            ? "80mm thermal · walk-in cash slip"
            : isWalkIn
              ? savedDefault === "thermal"
                ? "Standard invoice for this bill. Next walk-in still uses the thermal slip."
                : "Half A4 invoice. Turn on thermal to use it for every walk-in sale."
              : "Half A4 · loads on right side of paper"}
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

      {showSheet && showThermal ? (
        <div className="print-sheet thermal-80 mx-auto" data-paper="thermal">
          <div className="th-shop">{companyName || "Sale"}</div>
          {_companyPhone ? <div className="th-sub">{_companyPhone}</div> : null}
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
            <div className="th-credit-line">Developed by Umar Distributor</div>
            <div className="th-credit-line">03006031380</div>
            <div className="th-credit-line">03084882425</div>
          </div>
          {/* Exactly 2 line feeds before the cutter — not 4+. */}
          <div className="th-cut-feed" aria-hidden="true" />
        </div>
      ) : null}

      {showSheet && !showThermal ? (
      <div className="print-sheet si-half mx-auto" data-paper="a5">
        <div className="si-head">
          <div className="si-doc-label">Sale Invoice</div>
          {companyName ? (
            <div className="si-title">{companyName}</div>
          ) : (
            <div className="si-title">Sale Invoice</div>
          )}
        </div>

        <div className="si-meta">
          <div className="si-meta-left si-meta-block">
            <div>
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
            {ownerNo && ownerNo !== customerNo ? (
              <div>
                <span className="si-k">Owner No:</span>{" "}
                <span className="si-v">{ownerNo}</span>
              </div>
            ) : null}
          </div>
          <div className="si-meta-right si-meta-block">
            <div>
              <span className="si-k">Bill No :</span>{" "}
              <span className="si-v">{formatReportInvNo(docNo) || docNo}</span>
            </div>
            {sector ? (
              <div>
                <span className="si-k">Sector:</span>{" "}
                <span className="si-v">{sector}</span>
              </div>
            ) : null}
            <div>
              <span className="si-k">Date :</span>{" "}
              <span className="si-v">{dateTimeLabel}</span>
            </div>
          </div>
        </div>

        <table className="si-table">
          <colgroup>
            <col style={{ width: "4%" }} />
            <col style={{ width: "40%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "13%" }} />
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
            {lines.map((l, i) => {
              const pct = discPercent(l.qty, l.tradePrice, l.discount);
              const schemeLabel = formatSchemeLabel(l.scheme, l.bonus);
              return (
                <tr key={`${l.product_code || l.product_name}-${i}`}>
                  <td className="ctr">{i + 1}</td>
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
              سابقہ بل کی ادائیگی پر نیا مال دیا جائے گا۔
            </p>
            <div className="si-prepared">
              Prepared By : {(preparedBy || "—").toUpperCase()}
            </div>
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
        </div>
      </div>
      ) : null}
    </div>
  );
}

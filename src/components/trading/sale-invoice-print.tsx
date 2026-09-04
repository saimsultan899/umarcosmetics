"use client";

import { Button } from "@/components/ui/button";
import { formatNumber, formatPkr } from "@/lib/utils";
import { Printer } from "lucide-react";
import { useEffect, useRef } from "react";

export type SalePrintLine = {
  product_name: string;
  qty: number;
  bonus?: number;
  scheme?: string | null;
  tradePrice: number;
  discount: number;
  amount: number;
};

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
 * (Sr / Qty / Item / Trade Price / Disc% / Disc Val / Amount + dual footer).
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
  previousPayment = 0,
  lastPaidKind = null,
  previousBalance,
  creditDays = 21,
  preparedBy,
  autoPrint = false,
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
  /** Cash received against this invoice. */
  paid?: number;
  /** Last recovery / cash-on-sale from this shop (already in previous balance). */
  previousPayment?: number;
  /** Cash vs Credit label for Last Paid Amount. */
  lastPaidKind?: "Cash" | "Credit" | null;
  previousBalance: number;
  creditDays?: number;
  preparedBy?: string | null;
  autoPrint?: boolean;
}) {
  const paidOnBill = Math.max(0, paid);
  const paidShown = paidOnBill > 0 ? paidOnBill : previousPayment;
  const paidKind = paidShown > 0 ? lastPaidKind : null;
  const billPayable = Math.max(0, billAmount - paidOnBill);
  const totalPayable = billPayable + previousBalance;
  const prevLabel =
    previousBalance === 0
      ? "0.00"
      : `${formatNumber(Math.abs(previousBalance), 2)} ${previousBalance >= 0 ? "Dr" : "Cr"}`;

  const customerNumbers = Array.from(
    new Set([partyMobile, partyPhone].filter(Boolean) as string[]),
  );
  const dateTimeLabel = [formatDateLabel(date), formatTimeLabel(printedAt)]
    .filter(Boolean)
    .join(" ");

  const savedTitle = useRef("");

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
    if (!autoPrint) return;
    const t = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(t);
  }, [autoPrint]);

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-end gap-2">
        <p className="mr-auto text-sm text-[var(--muted)]">
          Half A4 · loads on right side of paper
        </p>
        <Button type="button" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Print
        </Button>
      </div>

      <div className="print-sheet si-half mx-auto">
        <div className="si-title">SALE INVOICE</div>
        {companyName ? <div className="si-company">{companyName}</div> : null}

        <div className="si-meta">
          <div className="si-meta-left si-meta-block">
            <div>
              <span className="si-k">A/C No :</span>{" "}
              <span className="si-v">
                {[partyCode, partyName].filter(Boolean).join(" ")}
              </span>
            </div>
            {partyOwner ? (
              <div>
                <span className="si-k">OWNER:</span>{" "}
                <span className="si-v">{partyOwner}</span>
              </div>
            ) : null}
            {customerNumbers.length > 0 ? (
              <div>
                <span className="si-k">Cust Mob No:</span>{" "}
                <span className="si-v">{customerNumbers.join(" / ")}</span>
              </div>
            ) : null}
          </div>
          <div className="si-meta-right si-meta-block">
            <div>
              <span className="si-k">Bill No :</span>{" "}
              <span className="si-v">{docNo}</span>
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
          <thead>
            <tr>
              <th className="ctr" style={{ width: "4%" }}>
                Sr.
              </th>
              <th className="num" style={{ width: "10%" }}>
                Qty
              </th>
              <th style={{ width: "34%" }}>ItemName</th>
              <th className="num" style={{ width: "10%" }}>
                Scheme
              </th>
              <th className="num" style={{ width: "12%" }}>
                Trade Price
              </th>
              <th className="num" style={{ width: "10%" }}>
                Disc %
              </th>
              <th className="num" style={{ width: "12%" }}>
                Disc Val
              </th>
              <th className="num" style={{ width: "12%" }}>
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const pct = discPercent(l.qty, l.tradePrice, l.discount);
              const schemeLabel = formatSchemeLabel(l.scheme, l.bonus);
              return (
                <tr key={`${l.product_name}-${i}`}>
                  <td className="ctr">{i + 1}</td>
                  <td className="num">{formatNumber(l.qty, 2)}</td>
                  <td>{l.product_name}</td>
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
              <span>
                Last Paid Amount
                {paidKind ? (
                  <span className="si-paid-kind"> ({paidKind})</span>
                ) : null}
              </span>
              <span>{formatNumber(paidShown, 2)}</span>
            </div>
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
    </div>
  );
}

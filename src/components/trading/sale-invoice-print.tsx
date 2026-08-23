"use client";

import { Button } from "@/components/ui/button";
import { formatNumber, formatPkr } from "@/lib/utils";
import { Printer } from "lucide-react";

export type SalePrintLine = {
  product_name: string;
  qty: number;
  bonus?: number;
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

/**
 * Half-A4 sale invoice print — matches classic distributor bill layout
 * (Sr / Qty / Item / Trade Price / Disc% / Disc Val / Amount + dual footer).
 */
export function SaleInvoicePrint({
  companyName,
  companyPhone,
  docNo,
  date,
  partyCode,
  partyName,
  partyOwner,
  partyPhone,
  sector,
  salesmanLabel,
  lines,
  subtotal,
  tradeDiscount,
  extraDiscount = 0,
  billAmount,
  previousBalance,
  creditDays = 21,
  preparedBy,
}: {
  companyName: string;
  companyPhone?: string | null;
  docNo: string;
  date: string;
  partyCode?: string | null;
  partyName?: string | null;
  partyOwner?: string | null;
  partyPhone?: string | null;
  sector?: string | null;
  salesmanLabel?: string | null;
  lines: SalePrintLine[];
  subtotal: number;
  tradeDiscount: number;
  extraDiscount?: number;
  billAmount: number;
  previousBalance: number;
  creditDays?: number;
  preparedBy?: string | null;
}) {
  const paid = 0; // credit-only sales
  const billPayable = Math.max(0, billAmount - paid);
  const totalPayable = billPayable + previousBalance;
  const prevLabel =
    previousBalance === 0
      ? "0.00"
      : `${formatNumber(Math.abs(previousBalance), 2)} ${previousBalance >= 0 ? "Dr" : "Cr"}`;

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-end gap-2">
        <p className="mr-auto text-sm text-[var(--muted)]">
          Half A4 · Credit sale invoice
        </p>
        <Button type="button" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Print
        </Button>
      </div>

      <div className="print-sheet si-half mx-auto">
        <div className="si-title">SALE INVOICE</div>
        {(salesmanLabel || companyPhone) && (
          <div className="si-salesman">
            {[salesmanLabel, companyPhone].filter(Boolean).join("  ")}
          </div>
        )}

        <div className="si-meta">
          <div className="si-meta-left">
            <div>
              <span className="si-k">A/C No :</span>{" "}
              <span className="si-v">
                {[partyCode, partyName].filter(Boolean).join(" ")}
              </span>
            </div>
            {(partyOwner || partyPhone) && (
              <div>
                <span className="si-k">OWNER:</span>{" "}
                <span className="si-v">
                  {[partyOwner, partyPhone].filter(Boolean).join(" ")}
                </span>
              </div>
            )}
            {companyName ? (
              <div className="si-co">{companyName}</div>
            ) : null}
          </div>
          <div className="si-meta-right">
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
              <span className="si-v">{formatDateLabel(date)}</span>
            </div>
          </div>
        </div>

        <table className="si-table">
          <thead>
            <tr>
              <th className="ctr" style={{ width: "8%" }}>
                Sr.
              </th>
              <th className="num" style={{ width: "12%" }}>
                Qty
              </th>
              <th style={{ width: "32%" }}>ItemName</th>
              <th className="num" style={{ width: "14%" }}>
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
              return (
                <tr key={`${l.product_name}-${i}`}>
                  <td className="ctr">{i + 1}</td>
                  <td className="num">
                    {formatNumber(l.qty, 2)}
                    {l.bonus && l.bonus > 0 ? (
                      <div className="si-bonus">+{formatNumber(l.bonus, 0)} B</div>
                    ) : null}
                  </td>
                  <td>{l.product_name}</td>
                  <td className="num">{formatNumber(l.tradePrice, 2)}</td>
                  <td className="num">{pct > 0 ? `${formatNumber(pct, 1)} %` : "—"}</td>
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
          <div className="si-foot-col">
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
            <p className="si-note">
              *Note: Please Clear This Bill Payment In {creditDays}-DAYS.
            </p>
            <div className="si-prepared">
              Prepared By : {(preparedBy || "—").toUpperCase()}
            </div>
          </div>

          <div className="si-foot-col">
            <div className="si-row">
              <span>Paid</span>
              <span>{formatNumber(paid, 2)}</span>
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

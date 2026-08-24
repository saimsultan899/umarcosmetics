"use client";

import { Button } from "@/components/ui/button";
import { cn, formatNumber } from "@/lib/utils";
import { Printer } from "lucide-react";
import { useState } from "react";

export type PrintLine = {
  product_code: string;
  product_name: string;
  qty: number;
  bonus?: number;
  uom?: string | null;
  rate?: number;
  discount?: number;
  amount?: number;
};

export type PrintMeta = { label: string; value: string; strong?: boolean };

/**
 * Generic document print — classic distributor layout shared by purchase
 * invoices, sales/purchase returns, transfers, load sheets and vouchers.
 * Matches the sale-invoice bill styling (serif, ruled table, right-aligned
 * totals, signature row); columns adapt to whichever fields the doc supplies.
 */
export function PrintDocument({
  companyName,
  companyAddress,
  companyNtn,
  companyPhone,
  title,
  docNo,
  date,
  partyName,
  partyCode,
  partyAddress,
  partyPhone,
  warehouseName,
  extraMeta,
  lines,
  totals,
  amountInWords,
  signatures,
  footerNote,
  size = "full",
}: {
  companyName: string;
  companyAddress?: string | null;
  companyNtn?: string | null;
  companyPhone?: string | null;
  title: string;
  docNo: string;
  date: string;
  partyName?: string | null;
  partyCode?: string | null;
  partyAddress?: string | null;
  partyPhone?: string | null;
  warehouseName?: string | null;
  extraMeta?: PrintMeta[];
  lines: PrintLine[];
  totals?: PrintMeta[];
  amountInWords?: string | null;
  signatures?: string[];
  footerNote?: string | null;
  size?: "full" | "half";
}) {
  const [sheet, setSheet] = useState<"full" | "half">(size);

  const hasRate = lines.some((l) => l.rate != null);
  const hasDiscount = lines.some((l) => l.discount != null && l.discount !== 0);
  const hasAmount = lines.some((l) => l.amount != null);
  const hasUom = lines.some((l) => l.uom);

  const companyLine = [companyName, companyPhone].filter(Boolean).join("  ");
  const companySub = [
    companyAddress,
    companyNtn ? `NTN/STRN: ${companyNtn}` : "",
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-end gap-2">
        <div className="mr-auto flex items-center gap-1 rounded-lg border border-[var(--border)] bg-white p-1 text-sm">
          <button
            type="button"
            onClick={() => setSheet("full")}
            className={cn(
              "rounded-md px-3 py-1",
              sheet === "full" ? "bg-[var(--brand)] text-white" : "text-[var(--muted)]",
            )}
          >
            Full page
          </button>
          <button
            type="button"
            onClick={() => setSheet("half")}
            className={cn(
              "rounded-md px-3 py-1",
              sheet === "half" ? "bg-[var(--brand)] text-white" : "text-[var(--muted)]",
            )}
          >
            Half page
          </button>
        </div>
        <Button type="button" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Print
        </Button>
      </div>

      <div className={cn("print-sheet cdoc mx-auto", sheet === "half" && "cdoc--half")}>
        <div className="si-title">{title}</div>
        {companyLine ? <div className="si-salesman">{companyLine}</div> : null}

        <div className="si-meta">
          <div className="si-meta-left">
            {partyName ? (
              <div>
                <span className="si-k">A/C No :</span>{" "}
                <span className="si-v">
                  {[partyCode, partyName].filter(Boolean).join(" ")}
                </span>
              </div>
            ) : null}
            {partyAddress ? <div className="si-co">{partyAddress}</div> : null}
            {partyPhone ? <div className="si-co">Ph: {partyPhone}</div> : null}
            {companySub ? <div className="si-co">{companySub}</div> : null}
          </div>
          <div className="si-meta-right">
            <div>
              <span className="si-k">No :</span> <span className="si-v">{docNo}</span>
            </div>
            <div>
              <span className="si-k">Date :</span>{" "}
              <span className="si-v">{date}</span>
            </div>
            {warehouseName ? (
              <div>
                <span className="si-k">Warehouse:</span>{" "}
                <span className="si-v">{warehouseName}</span>
              </div>
            ) : null}
            {(extraMeta ?? []).map((m) => (
              <div key={m.label}>
                <span className="si-k">{m.label}:</span>{" "}
                <span className="si-v">{m.value}</span>
              </div>
            ))}
          </div>
        </div>

        <table className="si-table">
          <thead>
            <tr>
              <th className="ctr" style={{ width: "8%" }}>
                Sr.
              </th>
              <th style={{ width: "16%" }}>Code</th>
              <th>ItemName</th>
              {hasUom ? <th className="ctr">UOM</th> : null}
              <th className="num">Qty</th>
              {hasRate ? <th className="num">Rate</th> : null}
              {hasDiscount ? <th className="num">Disc.</th> : null}
              {hasAmount ? <th className="num">Amount</th> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={`${l.product_code}-${i}`}>
                <td className="ctr">{i + 1}</td>
                <td>{l.product_code}</td>
                <td>{l.product_name}</td>
                {hasUom ? <td className="ctr">{l.uom || "—"}</td> : null}
                <td className="num">
                  {formatNumber(l.qty, 2)}
                  {l.bonus && l.bonus > 0 ? (
                    <div className="si-bonus">+{formatNumber(l.bonus, 0)} B</div>
                  ) : null}
                </td>
                {hasRate ? (
                  <td className="num">
                    {l.rate != null ? formatNumber(l.rate, 2) : "—"}
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
            ))}
          </tbody>
        </table>

        {totals?.length ? (
          <div className="cdoc-totals">
            {totals.map((t, i) => {
              const anyStrong = totals.some((x) => x.strong);
              const isGrand = t.strong ?? (!anyStrong && i === totals.length - 1);
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
        ) : null}

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
          {footerNote || "This is a computer-generated document · Umar Distribution Software"}
        </p>

        <div className="doc-cut">✂ — — — — — — — — — — cut here — — — — — — — — — —</div>
      </div>
    </div>
  );
}

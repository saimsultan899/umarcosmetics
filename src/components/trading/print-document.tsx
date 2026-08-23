"use client";

import { Button } from "@/components/ui/button";
import { cn, formatPkr } from "@/lib/utils";
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
  const hasBonus = lines.some((l) => l.bonus != null && l.bonus !== 0);
  const hasAmount = lines.some((l) => l.amount != null);
  const hasUom = lines.some((l) => l.uom);

  const infoRows: PrintMeta[] = [
    { label: "No", value: docNo },
    { label: "Date", value: date },
    ...(warehouseName ? [{ label: "Warehouse", value: warehouseName }] : []),
    ...(extraMeta ?? []),
  ];

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

      <div className={cn("print-sheet doc mx-auto", sheet === "half" && "doc--half")}>
        <div className="doc-head">
          <div>
            <div className="doc-company">{companyName}</div>
            <div className="doc-company-meta">
              {companyAddress ? <div>{companyAddress}</div> : null}
              {companyNtn || companyPhone ? (
                <div>
                  {companyNtn ? `NTN/STRN: ${companyNtn}` : ""}
                  {companyNtn && companyPhone ? "  ·  " : ""}
                  {companyPhone ? `Ph: ${companyPhone}` : ""}
                </div>
              ) : null}
            </div>
          </div>
          <div className="doc-title-wrap">
            <span className="doc-title">{title}</span>
          </div>
        </div>

        <div className="doc-parties">
          {partyName ? (
            <div>
              <div className="doc-billto-label">Bill to</div>
              <div className="doc-party-name">
                {partyCode ? `${partyCode} — ` : ""}
                {partyName}
              </div>
              {partyAddress ? <div className="doc-party-sub">{partyAddress}</div> : null}
              {partyPhone ? <div className="doc-party-sub">Ph: {partyPhone}</div> : null}
            </div>
          ) : (
            <div />
          )}
          <div className="doc-info">
            {infoRows.map((m) => (
              <div key={m.label} className="doc-info-row">
                <span>{m.label}:</span>
                <span>{m.value}</span>
              </div>
            ))}
          </div>
        </div>

        <table className="doc-table">
          <thead>
            <tr>
              <th className="ctr" style={{ width: "8mm" }}>
                #
              </th>
              <th style={{ width: "22mm" }}>Code</th>
              <th>Item</th>
              {hasUom ? <th className="ctr">UOM</th> : null}
              <th className="num">Qty</th>
              {hasBonus ? <th className="num">Bonus</th> : null}
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
                <td className="num">{l.qty}</td>
                {hasBonus ? (
                  <td className="num">{l.bonus ? l.bonus : "—"}</td>
                ) : null}
                {hasRate ? (
                  <td className="num">{l.rate != null ? formatPkr(l.rate) : "—"}</td>
                ) : null}
                {hasDiscount ? (
                  <td className="num">{l.discount ? formatPkr(l.discount) : "—"}</td>
                ) : null}
                {hasAmount ? (
                  <td className="num">{l.amount != null ? formatPkr(l.amount) : "—"}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>

        {totals?.length ? (
          <div className="doc-totals">
            {totals.map((t, i) => {
              const anyStrong = totals.some((x) => x.strong);
              const isGrand = t.strong ?? (!anyStrong && i === totals.length - 1);
              return (
                <div key={t.label} className={cn("doc-total-row", isGrand && "grand")}>
                  <span>{t.label}</span>
                  <span>{t.value}</span>
                </div>
              );
            })}
          </div>
        ) : null}

        {amountInWords ? (
          <p className="doc-words">
            <b>Amount in words:</b> {amountInWords}
          </p>
        ) : null}

        {signatures?.length ? (
          <div className="doc-sign">
            {signatures.map((s) => (
              <div key={s}>{s}</div>
            ))}
          </div>
        ) : null}

        <p className="doc-foot">
          {footerNote || "This is a computer-generated document · Umar Distribution Software"}
        </p>

        <div className="doc-cut">✂ — — — — — — — — — — cut here — — — — — — — — — —</div>
      </div>
    </div>
  );
}

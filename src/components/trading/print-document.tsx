"use client";

import { Button } from "@/components/ui/button";
import { cn, formatNumber } from "@/lib/utils";
import { Printer } from "lucide-react";
import { useEffect, useState } from "react";

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
  warehouseName,
  extraMeta,
  lines,
  totals,
  amountInWords,
  signatures,
  footerNote,
  size = "full",
  autoPrint = false,
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
  warehouseName?: string | null;
  extraMeta?: PrintMeta[];
  lines: PrintLine[];
  totals?: PrintMeta[];
  amountInWords?: string | null;
  signatures?: string[];
  footerNote?: string | null;
  size?: "full" | "half";
  autoPrint?: boolean;
}) {
  const [sheet, setSheet] = useState<"full" | "half">(size);

  useEffect(() => {
    if (!autoPrint) return;
    const t = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(t);
  }, [autoPrint]);

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
        {companyName ? <div className="si-company">{companyName}</div> : null}
        {companyAddress ? (
          <div className="si-distributor-addr">{companyAddress}</div>
        ) : null}
        {companyPhone || companyNtn ? (
          <div className="si-distributor-addr">
            {[companyPhone, companyNtn ? `NTN/STRN: ${companyNtn}` : ""]
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
                    : [partyCode, partyName].filter(Boolean).join(" ")}
                </span>
              </div>
            ) : null}
            {partyAddress ? (
              <div className="si-co">{partyAddress}</div>
            ) : null}
            {partyCity ? <div className="si-co">{partyCity}</div> : null}
            {partyPhone ? <div className="si-co">Ph: {partyPhone}</div> : null}
          </div>
          <div className="si-meta-right">
            <div>
              <span className="si-k">No :</span> <span className="si-v">{docNo}</span>
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
              <th className="ctr" style={{ width: "7%" }}>
                Sr.
              </th>
              {hasLineCompany ? (
                <th style={{ width: "14%" }}>Company</th>
              ) : null}
              <th>ItemName</th>
              <th className="num" style={{ width: "12%" }}>
                Qty
              </th>
              {hasUom ? (
                <th className="ctr" style={{ width: "10%" }}>
                  Carton
                </th>
              ) : null}
              {hasRate ? <th className="num">Rate</th> : null}
              {hasDiscount ? <th className="num">Disc %</th> : null}
              {hasDiscount ? <th className="num">Disc Val</th> : null}
              {hasAmount ? <th className="num">Amount</th> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const packing = Number(l.packing || 0);
              const cartonValue =
                packing > 1
                  ? formatCartonQty(l.qty, packing)
                  : l.uom || l.base_unit || l.unit_type || "—";
              return (
                <tr key={`${l.product_code}-${i}`}>
                  <td className="ctr">{i + 1}</td>
                  {hasLineCompany ? (
                    <td>{l.company || "—"}</td>
                  ) : null}
                  <td>
                    {[l.product_code, l.product_name].filter(Boolean).join(" ")}
                  </td>
                  <td className="num">
                    <div>{formatNumber(l.qty, 2)}</div>
                    {l.bonus && l.bonus > 0 ? (
                      <div className="si-bonus">+{formatNumber(l.bonus, 0)} B</div>
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

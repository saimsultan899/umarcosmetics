"use client";

import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/utils";
import { Printer } from "lucide-react";
import { useEffect } from "react";

function formatCartonQty(qty: number, packing: number) {
  if (!(packing > 1)) return "—";
  return formatNumber(qty / packing, 2);
}

export type GatePassPrintLine = {
  product_code: string;
  product_name: string;
  qty: number;
  packing?: number;
  unit_type?: string | null;
  base_unit?: string | null;
};

export function GatePassPrint({
  companyName,
  companyAddress,
  companyNtn,
  companyPhone,
  passNo,
  date,
  supplierCode,
  supplierName,
  supplierAddress,
  warehouseName,
  brand,
  vehicleNo,
  transporter,
  poNo,
  biltyNo,
  remarks,
  lines,
  preparedBy,
  autoPrint = false,
}: {
  companyName: string;
  companyAddress?: string | null;
  companyNtn?: string | null;
  companyPhone?: string | null;
  passNo: string;
  date: string;
  supplierCode?: string | null;
  supplierName?: string | null;
  supplierAddress?: string | null;
  warehouseName?: string | null;
  brand?: string | null;
  vehicleNo?: string | null;
  transporter?: string | null;
  poNo?: string | null;
  biltyNo?: string | null;
  remarks?: string | null;
  lines: GatePassPrintLine[];
  preparedBy?: string | null;
  autoPrint?: boolean;
}) {
  const totalQty = lines.reduce((s, l) => s + Number(l.qty || 0), 0);

  useEffect(() => {
    if (!autoPrint) return;
    const t = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(t);
  }, [autoPrint]);

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-end gap-2">
        <p className="mr-auto text-sm text-[var(--muted)]">
          Incoming load sheet · does not update inventory
        </p>
        <Button type="button" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Print
        </Button>
      </div>

      <div className="print-sheet gp-sheet mx-auto">
        <div className="gp-head">
          <div className="gp-co">
            <p className="gp-co-name">{companyName}</p>
            {companyAddress ? <p>{companyAddress}</p> : null}
            <p>
              {[companyPhone ? `Ph: ${companyPhone}` : "", companyNtn ? `NTN: ${companyNtn}` : ""]
                .filter(Boolean)
                .join("  ·  ")}
            </p>
          </div>
          <div className="gp-title-wrap">
            <p className="gp-title">Gate Pass</p>
            <p className="gp-copy">Receiving copy</p>
          </div>
        </div>

        <div className="gp-meta">
          <div>
            <div>
              <span className="si-k">Gate Pass No :</span>{" "}
              <span className="si-v">{passNo}</span>
            </div>
            <div>
              <span className="si-k">Date :</span> <span className="si-v">{date}</span>
            </div>
            <div>
              <span className="si-k">Vendor :</span>{" "}
              <span className="si-v">
                {[supplierCode, supplierName].filter(Boolean).join(" ") || "—"}
              </span>
            </div>
            {supplierAddress ? (
              <div>
                <span className="si-k">Address :</span>{" "}
                <span className="si-v">{supplierAddress}</span>
              </div>
            ) : null}
            {transporter ? (
              <div>
                <span className="si-k">Transporter :</span>{" "}
                <span className="si-v">{transporter}</span>
              </div>
            ) : null}
            {vehicleNo ? (
              <div>
                <span className="si-k">Vehicle :</span>{" "}
                <span className="si-v">{vehicleNo}</span>
              </div>
            ) : null}
          </div>
          <div>
            <div>
              <span className="si-k">Company :</span>{" "}
              <span className="si-v">{companyName}</span>
            </div>
            {warehouseName ? (
              <div>
                <span className="si-k">Receiving company :</span>{" "}
                <span className="si-v">{warehouseName}</span>
              </div>
            ) : null}
            {brand ? (
              <div>
                <span className="si-k">Brand / load :</span>{" "}
                <span className="si-v">{brand}</span>
              </div>
            ) : null}
            {poNo ? (
              <div>
                <span className="si-k">PO # :</span> <span className="si-v">{poNo}</span>
              </div>
            ) : null}
            {biltyNo ? (
              <div>
                <span className="si-k">Bilty # :</span>{" "}
                <span className="si-v">{biltyNo}</span>
              </div>
            ) : null}
          </div>
        </div>

        <table className="si-table">
          <thead>
            <tr>
              <th className="ctr" style={{ width: "8%" }}>
                S.No
              </th>
              <th style={{ width: "16%" }}>Product Code</th>
              <th>Product Description</th>
              <th className="ctr" style={{ width: "12%" }}>
                Carton
              </th>
              <th className="num" style={{ width: "12%" }}>
                Qty
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const packing = Number(l.packing || 0);
              return (
                <tr key={`${l.product_code}-${i}`}>
                  <td className="ctr">{i + 1}</td>
                  <td>{l.product_code}</td>
                  <td>{l.product_name}</td>
                  <td className="ctr">{formatCartonQty(l.qty, packing)}</td>
                  <td className="num">{formatNumber(l.qty, 2)}</td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={4} className="num" style={{ fontWeight: 700 }}>
                Total qty
              </td>
              <td className="num" style={{ fontWeight: 700 }}>
                {formatNumber(totalQty, 2)}
              </td>
            </tr>
          </tbody>
        </table>

        {remarks ? <p className="gp-note">Remarks: {remarks}</p> : null}

        <p className="gp-note">
          Match this list against the physical load. Stock is added only when a
          purchase invoice is posted.
        </p>

        <div className="cdoc-sign-row">
          <div>Authority</div>
          <div>Received in good condition</div>
          <div>Gate clerk</div>
        </div>

        <p className="cdoc-foot">
          Printed for {companyName}
          {preparedBy ? ` · Prepared by ${preparedBy}` : ""} · computer-generated
          gate pass
        </p>
      </div>
    </div>
  );
}

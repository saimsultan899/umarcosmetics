"use client";

import type { SaleOrderDetail } from "@/lib/sales/sale-orders";
import { formatPkr } from "@/lib/utils";

export function SaleOrderLines({ order }: { order: SaleOrderDetail }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-white">
      <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
        <p className="text-sm font-semibold">{order.partyName}</p>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          {order.qty} qty · {formatPkr(order.amount)}
        </p>
      </div>
      <div className="table-shell border-0 shadow-none">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Company</th>
              <th className="text-right">Qty</th>
              <th className="text-right">TP</th>
              <th className="text-right">Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  <span className="block font-medium">{line.product_name}</span>
                  <span className="text-xs text-[var(--muted)]">{line.product_code || "—"}</span>
                </td>
                <td>{line.warehouse_name}</td>
                <td className="text-right">{line.qty}</td>
                <td className="text-right">{formatPkr(line.rate)}</td>
                <td className="text-right">{formatPkr(line.amount)}</td>
                <td>{line.status === "open" ? "Waiting" : "Billed"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

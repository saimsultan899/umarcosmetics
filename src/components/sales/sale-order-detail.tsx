"use client";

import {
  CancelOrderButton,
  FulfilCompanyButton,
} from "@/components/sales/sale-order-actions";
import { SaleOrderEditForm } from "@/components/sales/sale-order-edit-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { SaleOrderDetail } from "@/lib/sales/sale-orders";
import { cn, formatPkr } from "@/lib/utils";
import { Pencil } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

function shortDate(value: string) {
  const [y, m, d] = value.slice(0, 10).split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

function statusTone(status: string) {
  if (status === "open") return "bg-amber-50 text-amber-800";
  if (status === "fulfilled") return "bg-emerald-50 text-emerald-800";
  return "bg-[var(--surface-2)] text-[var(--muted)]";
}

export function SaleOrderDetailView({
  order,
  canManage,
}: {
  order: SaleOrderDetail;
  canManage: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const groups = useMemo(() => {
    const map = new Map<string, typeof order.lines>();
    for (const line of order.lines) {
      const list = map.get(line.warehouse_id) || [];
      list.push(line);
      map.set(line.warehouse_id, list);
    }
    return [...map.entries()].map(([warehouseId, lines], index) => {
      const open = lines.some((line) => line.status === "open");
      const fulfilled = lines.every((line) => line.status === "fulfilled");
      return {
        warehouseId,
        lines,
        index: index + 1,
        name: lines[0]?.warehouse_name || "Company",
        amount: lines.reduce((sum, line) => sum + line.amount, 0),
        qty: lines.reduce((sum, line) => sum + line.qty, 0),
        open,
        fulfilled,
        invoiceId: lines.find((line) => line.sale_invoice_id)?.sale_invoice_id || null,
      };
    });
  }, [order.lines]);

  const anyFulfilled = order.lines.some((line) => line.status === "fulfilled");
  const anyOpen = order.lines.some((line) => line.status === "open");
  const canEdit = canManage && order.status === "open" && anyOpen;

  return (
    <div className="animate-rise mx-auto w-full max-w-5xl space-y-4">
      <Link href="/sales/orders" className="text-sm font-medium text-[var(--brand)]">
        All salesman orders
      </Link>

      <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
                {order.orderNo}
              </h1>
              <span
                className={cn(
                  "rounded-[var(--radius-sm)] px-2 py-1 text-[11px] font-semibold capitalize",
                  statusTone(order.status),
                )}
              >
                {order.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {order.partyName} · {shortDate(order.orderDate)}
            </p>
            <p className="mt-1 text-sm">
              Salesman <span className="font-medium">{order.salesmanName}</span>
              {" · "}
              {groups.length} company bill{groups.length === 1 ? "" : "s"}
              {" · "}
              {formatPkr(order.amount)}
            </p>
            {order.note ? (
              <p className="mt-2 text-sm text-[var(--muted)]">{order.note}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            ) : null}
            {canManage && order.status === "open" && anyOpen ? (
              <CancelOrderButton orderId={order.id} partial={anyFulfilled} />
            ) : null}
          </div>
        </div>
      </div>

      <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--muted)]">
        Same customer order, separate company bills.{" "}
        <span className="font-medium text-[var(--ink)]">{order.partyName}</span> placed{" "}
        {groups.length} bill{groups.length === 1 ? "" : "s"} on {order.orderNo}. Fulfil
        or open each company on its own — they do not mix into one invoice.
      </div>

      <div className="space-y-5">
        {groups.map((group) => (
          <section
            key={group.warehouseId}
            className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-white shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--brand)]">
                  Separate bill {group.index} of {groups.length}
                </p>
                <h2 className="mt-0.5 text-lg font-semibold">{group.name}</h2>
                <p className="mt-0.5 text-sm text-[var(--muted)]">
                  Credit bill for {order.partyName}
                </p>
                <p className="mt-0.5 text-sm font-medium">
                  {group.qty} qty · {formatPkr(group.amount)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-[var(--radius-sm)] px-2 py-1 text-[11px] font-semibold",
                    group.open
                      ? "bg-amber-50 text-amber-800"
                      : "bg-emerald-50 text-emerald-800",
                  )}
                >
                  {group.open ? "Waiting" : "Billed"}
                </span>
                {canManage && group.open && order.status === "open" ? (
                  <FulfilCompanyButton
                    orderId={order.id}
                    warehouseId={group.warehouseId}
                    companyName={group.name}
                  />
                ) : group.invoiceId ? (
                  <Link
                    href={`/sales/invoices/${group.invoiceId}`}
                    className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-white px-3 text-sm font-medium"
                  >
                    View sale invoice
                  </Link>
                ) : null}
              </div>
            </div>
            <div className="table-shell border-0 shadow-none">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">TP</th>
                    <th className="text-right">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {group.lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <span className="block font-medium">{line.product_name}</span>
                        <span className="text-xs text-[var(--muted)]">
                          {line.product_code || "—"}
                        </span>
                      </td>
                      <td className="text-right">{line.qty}</td>
                      <td className="text-right">{formatPkr(line.rate)}</td>
                      <td className="text-right">{formatPkr(line.amount)}</td>
                      <td className="capitalize">{line.status === "open" ? "Waiting" : "Billed"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Edit ${order.orderNo}`}
        className="max-w-[96vw] sm:max-w-6xl lg:max-w-7xl xl:max-w-[1360px]"
      >
        <SaleOrderEditForm order={order} onDone={() => setEditOpen(false)} />
      </Dialog>
    </div>
  );
}

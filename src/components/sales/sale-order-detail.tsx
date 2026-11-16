"use client";

import { CancelOrderButton, FulfilOrderButton } from "@/components/sales/sale-order-actions";
import { SaleOrderEditForm } from "@/components/sales/sale-order-edit-form";
import { SaleOrderLines } from "@/components/sales/sale-order-lines";
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
  const openWarehouseIds = useMemo(
    () => [
      ...new Set(
        order.lines.filter((line) => line.status === "open").map((line) => line.warehouse_id),
      ),
    ],
    [order.lines],
  );
  const invoiceIds = useMemo(
    () => [
      ...new Set(
        order.lines
          .map((line) => line.sale_invoice_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ],
    [order.lines],
  );
  const anyFulfilled = order.lines.some((line) => line.status === "fulfilled");
  const canEdit = canManage && order.status === "open" && openWarehouseIds.length > 0;

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
            {canManage && order.status === "open" && openWarehouseIds.length > 0 ? (
              <CancelOrderButton orderId={order.id} partial={anyFulfilled} />
            ) : null}
          </div>
        </div>
      </div>

      <SaleOrderLines order={order} />

      <div className="flex flex-wrap items-center justify-end gap-2">
        {invoiceIds.map((invoiceId, index) => (
          <Link
            key={invoiceId}
            href={`/sales/invoices/${invoiceId}`}
            className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-white px-3 text-sm font-medium"
          >
            {invoiceIds.length > 1 ? `View invoice ${index + 1}` : "View sale invoice"}
          </Link>
        ))}
        {canManage && openWarehouseIds.length > 0 && order.status === "open" ? (
          <FulfilOrderButton
            orderId={order.id}
            warehouseIds={openWarehouseIds}
            customerName={order.partyName}
          />
        ) : null}
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

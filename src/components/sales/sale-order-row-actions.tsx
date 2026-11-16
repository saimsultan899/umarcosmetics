"use client";

import { FulfilOrderButton } from "@/components/sales/sale-order-actions";
import { SaleOrderEditForm } from "@/components/sales/sale-order-edit-form";
import { SaleOrderLines } from "@/components/sales/sale-order-lines";
import { Dialog } from "@/components/ui/dialog";
import { RowActions } from "@/components/ui/row-actions";
import { createClient } from "@/lib/supabase/client";
import {
  mapSaleOrder,
  SALE_ORDER_SELECT,
  type SaleOrderDetail,
  type SaleOrderListRow,
  type SaleOrderQueryRow,
} from "@/lib/sales/sale-orders";
import { formatPkr } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

function shortDate(value: string) {
  const [y, m, d] = value.slice(0, 10).split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

function statusLabel(status: string) {
  if (status === "fulfilled") return "Fulfilled";
  if (status === "cancelled") return "Cancelled";
  return "Open";
}

function SaleOrderEditorLoader({
  orderId,
  onDone,
}: {
  orderId: string;
  onDone: () => void;
}) {
  const [detail, setDetail] = useState<SaleOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: loadError } = await createClient()
        .from("sale_orders")
        .select(SALE_ORDER_SELECT)
        .eq("id", orderId)
        .maybeSingle();
      if (cancelled) return;
      if (loadError) {
        setError(loadError.message);
        return;
      }
      if (!data) {
        setError("Order not found");
        return;
      }
      setDetail(mapSaleOrder(data as unknown as SaleOrderQueryRow));
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!detail) {
    return <p className="text-sm text-[var(--muted)]">Opening order editor…</p>;
  }
  return (
    <SaleOrderEditForm order={detail} onDone={onDone} />
  );
}

function SaleOrderFulfilReview({
  orderId,
  onDone,
}: {
  orderId: string;
  onDone: () => void;
}) {
  const [detail, setDetail] = useState<SaleOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: loadError } = await createClient()
        .from("sale_orders")
        .select(SALE_ORDER_SELECT)
        .eq("id", orderId)
        .maybeSingle();
      if (cancelled) return;
      if (loadError) {
        setError(loadError.message);
        return;
      }
      if (!data) {
        setError("Order not found");
        return;
      }
      setDetail(mapSaleOrder(data as unknown as SaleOrderQueryRow));
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!detail) {
    return <p className="py-8 text-center text-sm text-[var(--muted)]">Opening order…</p>;
  }

  const openWarehouseIds = [
    ...new Set(
      detail.lines.filter((line) => line.status === "open").map((line) => line.warehouse_id),
    ),
  ];

  return (
    <div className="space-y-4">
      <SaleOrderLines order={detail} />
      <div className="flex justify-end">
        {openWarehouseIds.length ? (
          <FulfilOrderButton
            orderId={detail.id}
            warehouseIds={openWarehouseIds}
            customerName={detail.partyName}
            onDone={onDone}
          />
        ) : (
          <p className="text-sm text-[var(--muted)]">This order is already billed.</p>
        )}
      </div>
    </div>
  );
}

export function SaleOrderRowActions({ row }: { row: SaleOrderListRow }) {
  const router = useRouter();
  const [fulfilOpen, setFulfilOpen] = useState(false);
  const canFulfil = row.status === "open";

  async function deleteOrder() {
    const { error: rpcError } = await createClient().rpc("cancel_sale_order", {
      p_order_id: row.id,
    });
    if (rpcError) throw new Error(rpcError.message);
    router.refresh();
  }

  return (
    <div className="inline-flex items-center justify-end gap-1">
      {canFulfil ? (
        <button
          type="button"
          onClick={() => setFulfilOpen(true)}
          className="inline-flex h-8 items-center rounded-[var(--radius-sm)] bg-[var(--brand)] px-2.5 text-xs font-semibold text-white"
        >
          Fulfil
        </button>
      ) : null}
      <RowActions
      viewTitle={row.orderNo}
      href={`/sales/orders/${row.id}`}
      viewFields={[
        { label: "Order", value: row.orderNo },
        { label: "Date", value: shortDate(row.orderDate) },
        { label: "Salesman", value: row.salesmanName },
        { label: "Customer", value: row.partyName },
        { label: "Companies", value: row.companies.join(", ") || "—" },
        { label: "Qty", value: row.qty },
        { label: "Amount", value: formatPkr(row.amount) },
        { label: "Status", value: statusLabel(row.status) },
      ]}
      allowEdit={row.status === "open"}
      editTitle={`Edit ${row.orderNo}`}
      editClassName="max-w-[96vw] sm:max-w-6xl lg:max-w-7xl xl:max-w-[1360px]"
      editContent={
        row.status === "open"
          ? (close) => (
              <SaleOrderEditorLoader
                orderId={row.id}
                onDone={() => {
                  close();
                  router.refresh();
                }}
              />
            )
          : undefined
      }
      allowDelete={row.status === "open"}
      onDelete={row.status === "open" ? deleteOrder : undefined}
      deleteTitle="Delete this salesman order?"
      deleteDescription="If nothing is billed yet, the order is cancelled. If some companies are already billed, only the waiting companies are removed."
      deleteConfirmLabel="Delete order"
    />
      <Dialog
        open={fulfilOpen}
        onClose={() => setFulfilOpen(false)}
        title={`View ${row.orderNo}`}
        description="Review this customer order, then fulfil it."
        className="max-w-[96vw] sm:max-w-4xl"
      >
        {fulfilOpen ? (
          <SaleOrderFulfilReview
            orderId={row.id}
            onDone={() => {
              setFulfilOpen(false);
              router.refresh();
            }}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

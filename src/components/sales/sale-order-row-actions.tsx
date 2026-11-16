"use client";

import { SaleOrderEditForm } from "@/components/sales/sale-order-edit-form";
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

export function SaleOrderRowActions({ row }: { row: SaleOrderListRow }) {
  const router = useRouter();

  async function deleteOrder() {
    const { error: rpcError } = await createClient().rpc("cancel_sale_order", {
      p_order_id: row.id,
    });
    if (rpcError) throw new Error(rpcError.message);
    router.refresh();
  }

  return (
    <RowActions
      viewTitle={row.orderNo}
      href={`/sales/orders/${row.id}`}
      viewFields={[
        { label: "Order", value: row.orderNo },
        { label: "Date", value: shortDate(row.orderDate) },
        { label: "Salesman", value: row.salesmanName },
        { label: "Customer", value: row.partyName },
        {
          label: "Company bills",
          value:
            row.companyBills
              .map(
                (bill) =>
                  `${bill.name} (${bill.status === "open" ? "waiting" : "billed"} · ${formatPkr(bill.amount)})`,
              )
              .join(" · ") || "—",
        },
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
  );
}

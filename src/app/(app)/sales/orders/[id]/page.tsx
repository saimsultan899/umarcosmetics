import { CancelOrderButton, FulfilCompanyButton } from "@/components/sales/sale-order-actions";
import { requireCompanyContext } from "@/lib/auth";
import { mapSaleOrder, SALE_ORDER_SELECT, type SaleOrderQueryRow } from "@/lib/sales/sale-orders";
import { formatPkr } from "@/lib/utils";
import Link from "next/link";
import { notFound } from "next/navigation";

function shortDate(value: string) {
  const [y, m, d] = value.slice(0, 10).split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

export default async function SalesmanOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, company, offline, membership, profile } = await requireCompanyContext();
  if (offline) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Salesman orders need a connection.
      </div>
    );
  }

  const { data } = await supabase
    .from("sale_orders")
    .select(SALE_ORDER_SELECT)
    .eq("company_id", company.id)
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();
  const order = mapSaleOrder(data as unknown as SaleOrderQueryRow);
  const groups = new Map<string, typeof order.lines>();
  for (const line of order.lines) {
    const list = groups.get(line.warehouse_id) || [];
    list.push(line);
    groups.set(line.warehouse_id, list);
  }
  const anyFulfilled = order.lines.some((line) => line.status === "fulfilled");
  const canFulfil =
    profile?.is_super_admin === true ||
    ["super_admin", "org_admin", "company_admin", "accountant", "inventory", "sales_desk"].includes(
      membership?.role || "",
    );

  return (
    <div className="animate-rise mx-auto w-full max-w-4xl space-y-4">
      <Link href="/sales/orders" className="text-sm font-medium text-[var(--brand)]">
        All salesman orders
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
            {order.orderNo}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {order.salesmanName} · {order.partyName} · {shortDate(order.orderDate)} ·{" "}
            <span className="capitalize">{order.status}</span>
          </p>
          {order.note ? <p className="mt-2 text-sm">{order.note}</p> : null}
        </div>
        {canFulfil && order.status === "open" && !anyFulfilled ? (
          <CancelOrderButton orderId={order.id} />
        ) : null}
      </div>

      {[...groups.entries()].map(([warehouseId, lines]) => {
        const open = lines.some((line) => line.status === "open");
        const name = lines[0]?.warehouse_name || "Company";
        const amount = lines.reduce((sum, line) => sum + line.amount, 0);
        const invoiceId = lines.find((line) => line.sale_invoice_id)?.sale_invoice_id;
        return (
          <section
            key={warehouseId}
            className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div>
                <h2 className="text-base font-semibold">{name}</h2>
                <p className="text-xs text-[var(--muted)]">{formatPkr(amount)}</p>
              </div>
              {canFulfil && open && order.status === "open" ? (
                <FulfilCompanyButton orderId={order.id} warehouseId={warehouseId} />
              ) : invoiceId ? (
                <Link
                  href={`/sales/invoices/${invoiceId}`}
                  className="text-sm font-medium text-[var(--brand)]"
                >
                  View sale invoice
                </Link>
              ) : (
                <span className="text-sm text-[var(--muted)]">Fulfilled</span>
              )}
            </div>
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 text-right font-medium">TP</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-t border-[var(--border)]">
                    <td className="px-4 py-2">
                      <span className="block font-medium">{line.product_name}</span>
                      <span className="text-xs text-[var(--muted)]">{line.product_code}</span>
                    </td>
                    <td className="px-4 py-2 text-right">{line.qty}</td>
                    <td className="px-4 py-2 text-right">{formatPkr(line.rate)}</td>
                    <td className="px-4 py-2 text-right">{formatPkr(line.amount)}</td>
                    <td className="px-4 py-2 capitalize">{line.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}

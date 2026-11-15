"use client";

import { TableFilterSelect } from "@/components/tables/table-filter-select";
import { TablePagination } from "@/components/tables/table-pagination";
import { TableScroll } from "@/components/tables/table-scroll";
import { TableToolbar } from "@/components/tables/table-toolbar";
import { useClientPagination } from "@/hooks/use-client-pagination";
import { createClient } from "@/lib/supabase/client";
import { cn, formatPkr } from "@/lib/utils";
import { ClipboardList, Package, Store } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const card =
  "rounded-[var(--radius)] border border-[var(--border)] bg-white";
const field =
  "h-11 w-full rounded-[var(--radius-sm)] border border-[var(--field-border)] bg-white px-3 text-sm outline-none focus:border-[var(--field-border-hover)]";

export type OrderShop = {
  party_id: string;
  party_code: string;
  name_en: string;
  city: string | null;
  route: string | null;
  mobile: string | null;
  balance: number;
};

export type OrderProduct = {
  id: string;
  code: string | null;
  name_en: string;
  sale_rate: number | null;
  retail_rate: number | null;
  default_warehouse_id: string | null;
};

export type OrderWarehouse = {
  id: string;
  name: string;
};

export type FieldOrderRow = {
  id: string;
  order_no: string;
  order_date: string;
  status: string;
  note: string | null;
  partyName: string;
  qty: number;
  amount: number;
  companies: string[];
};

type History = {
  lastPaid: number | null;
  lastPaidDate: string | null;
  bills: Array<{ id: string; no: string; date: string; amount: number }>;
  recoveries: Array<{ id: string; date: string; amount: number }>;
};

function tradePrice(product: OrderProduct) {
  const sale = Number(product.sale_rate || 0);
  if (sale > 0) return sale;
  return Number(product.retail_rate || 0);
}

function shortDate(value: string | null | undefined) {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

export function FieldOrderApp({
  companyId,
  organizationId,
  shops,
  products,
  warehouses,
  orders,
}: {
  companyId: string;
  organizationId: string;
  shops: OrderShop[];
  products: OrderProduct[];
  warehouses: OrderWarehouse[];
  orders: FieldOrderRow[];
}) {
  const router = useRouter();
  const [online, setOnline] = useState(true);
  const [tab, setTab] = useState<"shops" | "catalog" | "orders">("shops");
  const [shopId, setShopId] = useState<string | null>(null);
  const [shopQuery, setShopQuery] = useState("");
  const [sector, setSector] = useState("");
  const [city, setCity] = useState("");
  const [due, setDue] = useState("");
  const [orderQuery, setOrderQuery] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [orderFilter, setOrderFilter] = useState<"all" | "open" | "fulfilled" | "cancelled">(
    "all",
  );
  const [qty, setQty] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const warehouseName = useMemo(() => {
    const map = new Map(warehouses.map((row) => [row.id, row.name]));
    return (id: string | null) => (id ? map.get(id) || "Company" : "No company");
  }, [warehouses]);

  const shop = shops.find((row) => row.party_id === shopId) || null;

  const sectors = useMemo(() => {
    const names = new Set<string>();
    for (const row of shops) {
      if (row.route) names.add(row.route);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [shops]);

  const visibleShops = useMemo(() => {
    const q = shopQuery.trim().toLowerCase();
    return shops.filter((row) => {
      if (sector && row.route !== sector) return false;
      if (city && row.city !== city) return false;
      const balance = Number(row.balance || 0);
      if (due === "due" && balance <= 0) return false;
      if (due === "nil" && Math.abs(balance) >= 0.005) return false;
      if (!q) return true;
      return `${row.party_code} ${row.name_en} ${row.city || ""} ${row.route || ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [shops, shopQuery, sector, city, due]);

  const dueTotal = useMemo(
    () => visibleShops.reduce((sum, row) => sum + Number(row.balance || 0), 0),
    [visibleShops],
  );

  const openOrders = useMemo(
    () => orders.filter((row) => row.status === "open"),
    [orders],
  );
  const cities = useMemo(() => {
    const names = new Set<string>();
    for (const row of shops) if (row.city) names.add(row.city);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [shops]);

  const visibleOrders = useMemo(() => {
    const q = orderQuery.trim().toLowerCase();
    return orders.filter((row) => {
      if (orderFilter !== "all" && row.status !== orderFilter) return false;
      if (!q) return true;
      return `${row.order_no} ${row.partyName} ${row.companies.join(" ")} ${row.note || ""}`
        .toLowerCase()
        .includes(q);
    });
  }, [orders, orderFilter, orderQuery]);

  const visibleProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    return products.filter((row) => {
      if (warehouseId && row.default_warehouse_id !== warehouseId) return false;
      if (!q) return true;
      return `${row.code || ""} ${row.name_en}`.toLowerCase().includes(q);
    });
  }, [products, productQuery, warehouseId]);

  const cart = useMemo(() => {
    const lines = products
      .filter((row) => (qty[row.id] || 0) > 0 && row.default_warehouse_id)
      .map((row) => {
        const lineQty = qty[row.id] || 0;
        const rate = tradePrice(row);
        return {
          product: row,
          qty: lineQty,
          rate,
          amount: Math.round(lineQty * rate * 100) / 100,
        };
      });
    return {
      lines,
      qty: lines.reduce((sum, line) => sum + line.qty, 0),
      amount: lines.reduce((sum, line) => sum + line.amount, 0),
    };
  }, [products, qty]);

  useEffect(() => {
    if (!shop) {
      setHistory(null);
      setHistoryFor(null);
      return;
    }
    let cancelled = false;
    setHistory(null);
    setHistoryFor(shop.party_id);
    const supabase = createClient();
    const today = new Date().toISOString().slice(0, 10);
    void (async () => {
      const [bills, recoveries, last] = await Promise.all([
        supabase
          .from("sale_invoices")
          .select("id, invoice_no, invoice_date, grand_total")
          .eq("company_id", companyId)
          .eq("party_id", shop.party_id)
          .eq("status", "posted")
          .order("invoice_date", { ascending: false })
          .limit(5),
        supabase
          .from("recoveries")
          .select("id, recovery_date, amount")
          .eq("company_id", companyId)
          .eq("party_id", shop.party_id)
          .order("recovery_date", { ascending: false })
          .limit(5),
        supabase.rpc("get_last_received_by_party", {
          p_company_id: companyId,
          p_as_of: today,
          p_from: null,
        }),
      ]);
      if (cancelled) return;
      const lastRow = ((last.data || []) as Array<{
        party_id: string;
        amount: number | string;
        received_date: string;
      }>).find((row) => row.party_id === shop.party_id);
      setHistory({
        lastPaid: lastRow ? Number(lastRow.amount || 0) : null,
        lastPaidDate: lastRow?.received_date || null,
        bills: (bills.data || []).map((row) => ({
          id: row.id,
          no: row.invoice_no,
          date: row.invoice_date,
          amount: Number(row.grand_total || 0),
        })),
        recoveries: (recoveries.data || []).map((row) => ({
          id: row.id,
          date: row.recovery_date,
          amount: Number(row.amount || 0),
        })),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [shop, companyId]);

  function changeQty(productId: string, next: number) {
    setQty((current) => {
      const copy = { ...current };
      if (next <= 0) delete copy[productId];
      else copy[productId] = next;
      return copy;
    });
  }

  async function submitOrder() {
    if (!shop || !online || cart.lines.length === 0) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("create_sale_order", {
      p_payload: {
        company_id: companyId,
        organization_id: organizationId,
        party_id: shop.party_id,
        note,
        lines: cart.lines.map((line) => ({
          product_id: line.product.id,
          qty: line.qty,
        })),
      },
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setQty({});
    setNote("");
    setShopId(null);
    setTab("orders");
    router.refresh();
  }

  if (!online) {
    return (
      <div className="rounded-[var(--radius)] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Take order needs a connection. Collect and Quick sale still work offline.
      </div>
    );
  }

  if (shop) {
    const historyReady = historyFor === shop.party_id && history;
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setShopId(null)}
          className="text-sm font-medium text-[var(--brand)]"
        >
          All shops
        </button>
        <div className={cn(card, "p-4")}>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            {shop.party_code}
            {shop.route ? ` · ${shop.route}` : ""}
            {shop.city ? ` · ${shop.city}` : ""}
          </p>
          <h2 className="mt-1 text-xl font-semibold">{shop.name_en}</h2>
          {shop.mobile ? (
            <p className="mt-1 text-sm text-[var(--muted)]">{shop.mobile}</p>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-[var(--radius)] bg-[var(--surface-2)] px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
                Receivable
              </p>
              <p className="text-base font-semibold">{formatPkr(shop.balance)}</p>
            </div>
            <div className="rounded-[var(--radius)] bg-[var(--surface-2)] px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
                Last paid
              </p>
              <p className="text-base font-semibold">
                {historyReady && history.lastPaid != null
                  ? formatPkr(history.lastPaid)
                  : "—"}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {historyReady ? shortDate(history.lastPaidDate) : "Loading"}
              </p>
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold text-[var(--muted)]">Recent bills</p>
              {historyReady && history.bills.length ? (
                <ul className="mt-1 space-y-1 text-sm">
                  {history.bills.map((bill) => (
                    <li key={bill.id} className="flex justify-between gap-2">
                      <span>
                        {bill.no} · {shortDate(bill.date)}
                      </span>
                      <span>{formatPkr(bill.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {historyReady ? "No bills yet" : "Loading"}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-[var(--muted)]">
                Recent recoveries
              </p>
              {historyReady && history.recoveries.length ? (
                <ul className="mt-1 space-y-1 text-sm">
                  {history.recoveries.map((row) => (
                    <li key={row.id} className="flex justify-between gap-2">
                      <span>{shortDate(row.date)}</span>
                      <span>{formatPkr(row.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {historyReady ? "No recoveries yet" : "Loading"}
                </p>
              )}
            </div>
          </div>
        </div>

        <ProductPicker
          products={visibleProducts}
          allCount={products.length}
          query={productQuery}
          onQuery={setProductQuery}
          warehouseId={warehouseId}
          onWarehouse={setWarehouseId}
          warehouses={warehouses}
          warehouseName={warehouseName}
          qty={qty}
          onQty={changeQty}
          ordering
        />

        {/* Space under the last product so it clears the sticky bar + phone nav. */}
        <div
          className={cn(
            "shrink-0",
            error ? "h-[14.5rem] md:h-[9.5rem]" : "h-[12.5rem] md:h-[8rem]",
          )}
          aria-hidden
        />

        <div className="fixed inset-x-0 bottom-[4.75rem] z-30 border-t border-[var(--border)] bg-white/95 px-3 py-3 backdrop-blur md:bottom-0">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Note for the office"
              className={field}
            />
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button
              type="button"
              disabled={busy || cart.lines.length === 0}
              onClick={() => void submitOrder()}
              className="inline-flex h-12 items-center justify-between rounded-[var(--radius)] bg-[var(--brand)] px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              <span>
                {busy ? "Sending…" : `Place order · ${cart.qty} qty`}
              </span>
              <span>{formatPkr(cart.amount)}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: "shops" as const, label: "Shops", count: shops.length, icon: Store },
    { id: "catalog" as const, label: "Catalog", count: products.length, icon: Package },
    { id: "orders" as const, label: "My orders", count: openOrders.length, icon: ClipboardList },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-1 rounded-[var(--radius)] bg-[var(--surface-3)] p-1">
        {tabs.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "flex h-11 flex-col items-center justify-center rounded-[var(--radius-sm)] text-[11px] font-semibold leading-tight",
                active
                  ? "bg-white text-[var(--brand)] shadow-sm"
                  : "text-[var(--muted)]",
              )}
            >
              <span className="inline-flex items-center gap-1">
                <Icon className="h-3.5 w-3.5" />
                {item.count}
              </span>
              {item.label}
            </button>
          );
        })}
      </div>
      {tab === "shops" ? (
        <ShopOrderTable
          shops={visibleShops}
          total={shops.length}
          query={shopQuery}
          onQuery={setShopQuery}
          sectors={sectors}
          sector={sector}
          onSector={setSector}
          cities={cities}
          city={city}
          onCity={setCity}
          due={due}
          onDue={setDue}
          dueTotal={dueTotal}
          onOpen={(id) => {
            setError(null);
            setShopId(id);
          }}
        />
      ) : null}

      {tab === "catalog" ? (
        <ProductPicker
          products={visibleProducts}
          allCount={products.length}
          query={productQuery}
          onQuery={setProductQuery}
          warehouseId={warehouseId}
          onWarehouse={setWarehouseId}
          warehouses={warehouses}
          warehouseName={warehouseName}
          qty={{}}
          onQty={() => undefined}
          ordering={false}
        />
      ) : null}

      {tab === "orders" ? (
        <OrderTable
          orders={visibleOrders}
          total={orders.length}
          query={orderQuery}
          onQuery={setOrderQuery}
          status={orderFilter}
          onStatus={setOrderFilter}
          openCount={openOrders.length}
          openAmount={openOrders.reduce((sum, row) => sum + row.amount, 0)}
        />
      ) : null}
    </div>
  );
}

function ShopOrderTable({
  shops,
  total,
  query,
  onQuery,
  sectors,
  sector,
  onSector,
  cities,
  city,
  onCity,
  due,
  onDue,
  dueTotal,
  onOpen,
}: {
  shops: OrderShop[];
  total: number;
  query: string;
  onQuery: (value: string) => void;
  sectors: string[];
  sector: string;
  onSector: (value: string) => void;
  cities: string[];
  city: string;
  onCity: (value: string) => void;
  due: string;
  onDue: (value: string) => void;
  dueTotal: number;
  onOpen: (id: string) => void;
}) {
  const page = useClientPagination(shops);
  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className={cn(card, "px-3 py-2.5")}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
            Shops
          </p>
          <p className="mt-0.5 text-lg font-semibold">{shops.length}</p>
        </div>
        <div className={cn(card, "px-3 py-2.5")}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
            Receivable
          </p>
          <p className="mt-0.5 truncate text-lg font-semibold">{formatPkr(dueTotal)}</p>
        </div>
      </div>
      <TableToolbar
        query={query}
        onQueryChange={onQuery}
        placeholder="Search shop, route, or city"
        resultCount={page.total}
        totalCount={total}
        filters={
          <>
            <TableFilterSelect
              label="Sector"
              value={sector}
              allLabel="All sectors"
              options={sectors.map((name) => ({ value: name, label: name }))}
              onChange={(value) => onSector(value || "")}
            />
            <TableFilterSelect
              label="City"
              value={city}
              allLabel="All cities"
              options={cities.map((name) => ({ value: name, label: name }))}
              onChange={(value) => onCity(value || "")}
            />
            <TableFilterSelect
              label="Balance"
              value={due}
              allLabel="All"
              options={[
                { value: "due", label: "Due" },
                { value: "nil", label: "Nil" },
              ]}
              onChange={(value) => onDue(value || "")}
            />
          </>
        }
      />
      <div className="table-shell">
        <TableScroll loading={page.isPending}>
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Shop</th>
                <th>Sector</th>
                <th>City</th>
                <th className="text-right">Due</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {page.slice.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[var(--muted)]">
                    No shops match.
                  </td>
                </tr>
              ) : (
                page.slice.map((row) => {
                  const balance = Number(row.balance || 0);
                  return (
                    <tr key={row.party_id}>
                      <td className="font-medium">{row.party_code}</td>
                      <td>{row.name_en}</td>
                      <td>{row.route || "—"}</td>
                      <td>{row.city || "—"}</td>
                      <td
                        className={cn(
                          "text-right font-semibold",
                          balance > 0 ? "text-rose-700" : "text-[var(--ink)]",
                        )}
                      >
                        {formatPkr(balance)}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => onOpen(row.party_id)}
                          className="inline-flex h-8 items-center rounded-[var(--radius-sm)] bg-[var(--brand)] px-2.5 text-xs font-semibold text-white"
                        >
                          Order
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableScroll>
        <TablePagination
          page={page.page}
          totalPages={page.totalPages}
          pageSize={page.pageSize}
          total={page.total}
          from={page.from}
          to={page.to}
          loading={page.isPending}
          onPageChange={page.setPage}
          onPageSizeChange={page.setPageSize}
        />
      </div>
    </div>
  );
}

function OrderTable({
  orders,
  total,
  query,
  onQuery,
  status,
  onStatus,
  openCount,
  openAmount,
}: {
  orders: FieldOrderRow[];
  total: number;
  query: string;
  onQuery: (value: string) => void;
  status: "all" | "open" | "fulfilled" | "cancelled";
  onStatus: (value: "all" | "open" | "fulfilled" | "cancelled") => void;
  openCount: number;
  openAmount: number;
}) {
  const page = useClientPagination(orders);
  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className={cn(card, "px-3 py-2.5")}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
            Open
          </p>
          <p className="mt-0.5 text-lg font-semibold">{openCount}</p>
        </div>
        <div className={cn(card, "px-3 py-2.5")}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
            Open amount
          </p>
          <p className="mt-0.5 truncate text-lg font-semibold">{formatPkr(openAmount)}</p>
        </div>
      </div>
      <TableToolbar
        query={query}
        onQueryChange={onQuery}
        placeholder="Search order, shop, or company"
        resultCount={page.total}
        totalCount={total}
        filters={
          <TableFilterSelect
            label="Status"
            value={status === "all" ? "" : status}
            allLabel="All"
            options={[
              { value: "open", label: "Open" },
              { value: "fulfilled", label: "Fulfilled" },
              { value: "cancelled", label: "Cancelled" },
            ]}
            onChange={(value) =>
              onStatus((value || "all") as "all" | "open" | "fulfilled" | "cancelled")
            }
          />
        }
      />
      <div className="table-shell">
        <TableScroll loading={page.isPending}>
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Date</th>
                <th>Shop</th>
                <th>Companies</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {page.slice.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[var(--muted)]">
                    No orders match.
                  </td>
                </tr>
              ) : (
                page.slice.map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium">
                      {row.order_no}
                      {row.note ? (
                        <p className="mt-0.5 max-w-[14rem] truncate text-[11px] font-normal text-[var(--muted)]">
                          {row.note}
                        </p>
                      ) : null}
                    </td>
                    <td>{shortDate(row.order_date)}</td>
                    <td>{row.partyName}</td>
                    <td>{row.companies.join(", ") || "—"}</td>
                    <td className="text-right">{row.qty}</td>
                    <td className="text-right">{formatPkr(row.amount)}</td>
                    <td>
                      <StatusPill status={row.status} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableScroll>
        <TablePagination
          page={page.page}
          totalPages={page.totalPages}
          pageSize={page.pageSize}
          total={page.total}
          from={page.from}
          to={page.to}
          loading={page.isPending}
          onPageChange={page.setPage}
          onPageSizeChange={page.setPageSize}
        />
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const label =
    status === "fulfilled" ? "Fulfilled" : status === "cancelled" ? "Cancelled" : "Open";
  return (
    <span
      className={cn(
        "rounded-[var(--radius-sm)] px-2 py-1 text-[11px] font-semibold",
        status === "open"
          ? "bg-amber-50 text-amber-800"
          : status === "fulfilled"
            ? "bg-emerald-50 text-emerald-800"
            : "bg-[var(--surface-2)] text-[var(--muted)]",
      )}
    >
      {label}
    </span>
  );
}

function ProductPicker({
  products,
  allCount,
  query,
  onQuery,
  warehouseId,
  onWarehouse,
  warehouses,
  warehouseName,
  qty,
  onQty,
  ordering,
}: {
  products: OrderProduct[];
  allCount: number;
  query: string;
  onQuery: (value: string) => void;
  warehouseId: string;
  onWarehouse: (value: string) => void;
  warehouses: OrderWarehouse[];
  warehouseName: (id: string | null) => string;
  qty: Record<string, number>;
  onQty: (productId: string, next: number) => void;
  ordering: boolean;
}) {
  const page = useClientPagination(products);
  return (
    <div>
      <TableToolbar
        query={query}
        onQueryChange={onQuery}
        placeholder="Search product or code"
        resultCount={page.total}
        totalCount={allCount}
        filters={
          <TableFilterSelect
            label="Company"
            value={warehouseId}
            allLabel="All companies"
            options={warehouses.map((row) => ({ value: row.id, label: row.name }))}
            onChange={(value) => onWarehouse(value || "")}
          />
        }
      />
      <div className="table-shell">
        <TableScroll loading={page.isPending}>
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Product</th>
                <th>Company</th>
                <th className="text-right">Trade price</th>
                {ordering ? <th className="text-right">Qty</th> : null}
              </tr>
            </thead>
            <tbody>
              {page.slice.length === 0 ? (
                <tr>
                  <td colSpan={ordering ? 5 : 4} className="py-8 text-center text-[var(--muted)]">
                    No products match.
                  </td>
                </tr>
              ) : (
                page.slice.map((row) => {
                  const count = qty[row.id] || 0;
                  const rate = tradePrice(row);
                  return (
                    <tr key={row.id} className={count > 0 ? "bg-[var(--stat-surface)]" : undefined}>
                      <td className="font-medium">{row.code || "—"}</td>
                      <td>{row.name_en}</td>
                      <td>{warehouseName(row.default_warehouse_id)}</td>
                      <td className="text-right font-semibold">{formatPkr(rate)}</td>
                      {ordering ? (
                        <td className="text-right">
                          {row.default_warehouse_id ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => onQty(row.id, count - 1)}
                                className="h-8 w-8 rounded-[var(--radius-sm)] border border-[var(--field-border)] bg-white text-lg"
                              >
                                −
                              </button>
                              <span className="w-7 text-center text-sm font-semibold">{count}</span>
                              <button
                                type="button"
                                onClick={() => onQty(row.id, count + 1)}
                                className="h-8 w-8 rounded-[var(--radius-sm)] bg-[var(--brand)] text-lg text-white"
                              >
                                +
                              </button>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableScroll>
        <TablePagination
          page={page.page}
          totalPages={page.totalPages}
          pageSize={page.pageSize}
          total={page.total}
          from={page.from}
          to={page.to}
          loading={page.isPending}
          onPageChange={page.setPage}
          onPageSizeChange={page.setPageSize}
        />
      </div>
    </div>
  );
}

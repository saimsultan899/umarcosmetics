"use client";

import { PartyCodePicker } from "@/components/forms/party-code-picker";
import { SalesmanSelect } from "@/components/forms/salesman-select";
import {
  LineItemsEditor,
  type LineItemsEditorHandle,
} from "@/components/trading/line-items-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { localDateIso } from "@/lib/dates";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import type { SaleOrderDetail } from "@/lib/sales/sale-orders";
import { createClient } from "@/lib/supabase/client";
import { useTradingCatalog } from "@/lib/trading/catalog-client";
import { calcLineAmount, type LineItemDraft } from "@/lib/types/trading";
import { formatPkr } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

function openLinesToDrafts(order: SaleOrderDetail): LineItemDraft[] {
  return order.lines
    .filter((line) => line.status === "open")
    .map((line) => ({
      key: line.id,
      product_id: line.product_id,
      product_code: line.product_code || "",
      product_name: line.product_name || "",
      qty: String(line.qty),
      bonus: "0",
      rate: String(line.rate),
      discount: "0",
      scheme: "",
      amount: line.amount,
    }));
}

export function SaleOrderEditForm({
  order,
  onDone,
}: {
  order: SaleOrderDetail;
  onDone?: () => void;
}) {
  const router = useRouter();
  const linesEditorRef = useRef<LineItemsEditorHandle>(null);
  const catalog = useTradingCatalog(order.companyId, {
    enabled: Boolean(order.companyId),
    stock: true,
    salesmen: true,
  });
  const openLineIds = useMemo(
    () =>
      new Set(
        order.lines.filter((line) => line.status === "open").map((line) => line.id),
      ),
    [order.lines],
  );
  const warehouseByKey = useRef(
    new Map(
      order.lines
        .filter((line) => line.status === "open")
        .map((line) => [line.id, line.warehouse_id] as const),
    ),
  );
  const billedCount = order.lines.filter((line) => line.status === "fulfilled").length;
  const initialWarehouse = useMemo(() => {
    const ids = [
      ...new Set(
        order.lines
          .filter((line) => line.status === "open")
          .map((line) => line.warehouse_id),
      ),
    ];
    return ids.length === 1 ? ids[0] : "";
  }, [order.lines]);

  const [partyId, setPartyId] = useState(order.partyId);
  const [salesmanId, setSalesmanId] = useState(order.salesmanId || "");
  const [warehouseId, setWarehouseId] = useState(initialWarehouse);
  const [orderDate, setOrderDate] = useState(order.orderDate.slice(0, 10));
  const [note, setNote] = useState(order.note || "");
  const [sector, setSector] = useState("");
  const [lines, setLines] = useState<LineItemDraft[]>(() => openLinesToDrafts(order));
  const [previousBalance, setPreviousBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customers = useMemo(
    () =>
      catalog.parties.filter(
        (party) =>
          party.party_subtype === "customer" ||
          party.party_subtype === "both" ||
          party.party_type === "PARTY",
      ),
    [catalog.parties],
  );
  const sectorOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const party of customers) {
      const route = (party.route || "").trim();
      if (!route) continue;
      const key = route.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(route);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [customers]);
  const filteredCustomers = useMemo(() => {
    if (!sector) return customers;
    return customers.filter((party) => (party.route || "").trim() === sector);
  }, [customers, sector]);
  const stockByProduct = useMemo(() => {
    const map = new Map<string, { warehouseId: string; qty: number }[]>();
    for (const row of catalog.stockBalances) {
      const qty = Number(row.qty);
      if (!Number.isFinite(qty)) continue;
      const list = map.get(row.product_id) || [];
      list.push({ warehouseId: row.warehouse_id, qty });
      map.set(row.product_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => b.qty - a.qty);
    return map;
  }, [catalog.stockBalances]);

  useEffect(() => {
    if (!partyId || sector) return;
    const hit = customers.find((party) => party.id === partyId);
    const route = (hit?.route || "").trim();
    if (route) setSector(route);
  }, [customers, partyId, sector]);

  useEffect(() => {
    let cancelled = false;
    async function loadPreviousBalance(id: string) {
      if (!id) {
        setPreviousBalance(null);
        return;
      }
      try {
        const result = await Promise.race([
          createClient().rpc("get_party_balance", {
            p_company_id: order.companyId,
            p_party_id: id,
            p_as_of: orderDate || localDateIso(),
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
        ]);
        const data =
          result && typeof result === "object" && "data" in result
            ? (result as { data: unknown }).data
            : null;
        if (!cancelled) setPreviousBalance(data == null ? null : Number(data));
      } catch {
        if (!cancelled) setPreviousBalance(null);
      }
    }
    void loadPreviousBalance(partyId);
    return () => {
      cancelled = true;
    };
  }, [order.companyId, orderDate, partyId]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const flushed = linesEditorRef.current?.flush() || lines;
    const valid = flushed.filter(
      (line) => line.product_id && Number(line.qty || 0) > 0,
    );
    if (valid.length === 0 && billedCount === 0) {
      setError("Add at least one product");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: rpcError } = await createClient().rpc("update_sale_order", {
        p_payload: {
          id: order.id,
          party_id: partyId,
          salesman_id: salesmanId || null,
          order_date: orderDate,
          note,
          keep_line_ids: valid
            .filter((line) => openLineIds.has(line.key))
            .map((line) => line.key),
          lines: valid.map((line) => {
            const qty = Number(line.qty || 0);
            const amount =
              Math.round(calcLineAmount(line.qty, line.rate, line.discount) * 100) /
              100;
            const rate = qty > 0 ? Math.round((amount / qty) * 10000) / 10000 : 0;
            const product = catalog.products.find((row) => row.id === line.product_id);
            const savedWarehouse =
              warehouseId ||
              warehouseByKey.current.get(line.key) ||
              product?.default_warehouse_id ||
              null;
            return {
              id: openLineIds.has(line.key) ? line.key : null,
              product_id: line.product_id,
              qty,
              rate,
              amount,
              warehouse_id: savedWarehouse,
            };
          }),
        },
      });
      if (rpcError) throw new Error(rpcError.message);
      onDone?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the order");
    } finally {
      setBusy(false);
    }
  }

  if (!catalog.ready) {
    return <p className="py-8 text-center text-sm text-[var(--muted)]">Opening entry…</p>;
  }
  if (catalog.error) {
    return (
      <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{catalog.error}</p>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3"
      data-enter-root
      onKeyDown={(event) => handleEnterAsNext(event)}
    >
      {billedCount ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {billedCount} line{billedCount === 1 ? "" : "s"} already billed and stay locked.
          This editor changes the waiting lines only.
        </p>
      ) : null}

      <div className="grid items-start gap-2 sm:grid-cols-12">
        <div className="sm:col-span-2">
          <Label>Date</Label>
          <Input
            type="date"
            value={orderDate}
            onChange={(event) => setOrderDate(event.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Sector</Label>
          <Select
            value={sector}
            onChange={(event) => setSector(event.target.value)}
            options={[
              { value: "", label: "All sectors" },
              ...sectorOptions.map((name) => ({ value: name, label: name })),
            ]}
          />
        </div>
        <div className="sm:col-span-8">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <PartyCodePicker
                companyId={order.companyId}
                parties={filteredCustomers}
                value={partyId}
                required
                label="Customer code / shop"
                filterSubtype={["customer", "both"]}
                confineToList={Boolean(sector)}
                emptyLabel={
                  sector
                    ? filteredCustomers.length
                      ? "Select customer"
                      : "No shops in this sector"
                    : "Select customer"
                }
                onChange={(id) => {
                  setPartyId(id);
                  if (id) {
                    const selected =
                      customers.find((party) => party.id === id) ||
                      catalog.parties.find((party) => party.id === id);
                    const route = (selected?.route || "").trim();
                    if (route) setSector(route);
                  } else {
                    setPreviousBalance(null);
                  }
                }}
              />
            </div>
            <div className="w-[9.5rem] shrink-0">
              <Label>Prev. balance</Label>
              <div className="flex h-10 items-center rounded-md border border-[var(--border)] bg-[var(--surface-2,#f8f8f8)] px-2 text-sm tabular-nums">
                {partyId ? (
                  previousBalance != null ? (
                    <span className="font-semibold text-[var(--ink)]">
                      {formatPkr(Math.abs(previousBalance))}{" "}
                      {previousBalance > 0.005
                        ? "Dr"
                        : previousBalance < -0.005
                          ? "Cr"
                          : "Nil"}
                    </span>
                  ) : (
                    <span className="text-[var(--muted)]">…</span>
                  )
                ) : (
                  <span className="text-[var(--muted)]">—</span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="sm:col-span-3" title="Fills automatically when you pick a product.">
          <Label>Company</Label>
          <Select
            value={warehouseId}
            onChange={(event) => setWarehouseId(event.target.value)}
            options={[
              { value: "", label: "Auto from product" },
              ...catalog.warehouses.map((warehouse) => ({
                value: warehouse.id,
                label: warehouse.name,
              })),
            ]}
          />
        </div>
        <div className="sm:col-span-2">
          <Label>Payment</Label>
          <Select value="credit" disabled>
            <option value="credit">Credit</option>
          </Select>
        </div>
        <div className={catalog.salesmen.length ? "sm:col-span-5" : "sm:col-span-7"}>
          <Label>Narration</Label>
          <Input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional notes"
          />
        </div>
        {catalog.salesmen.length ? (
          <div className="sm:col-span-2">
            <SalesmanSelect
              salesmen={catalog.salesmen}
              value={salesmanId}
              onChange={setSalesmanId}
              hideHint
            />
          </div>
        ) : null}
      </div>

      <LineItemsEditor
        ref={linesEditorRef}
        products={catalog.products}
        lines={lines}
        onChange={setLines}
        rateField="sale_rate"
        companyId={order.companyId}
        partyId={partyId}
        warehouseId={warehouseId}
        warehouses={catalog.warehouses}
        stockByProduct={stockByProduct}
        allowOversell
        onAutoPickWarehouse={setWarehouseId}
      />

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <Button type="submit" loading={busy}>
        {busy ? "Updating invoice..." : "Update sale invoice"}
      </Button>
    </form>
  );
}

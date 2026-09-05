"use client";

import { PartyCodePicker } from "@/components/forms/party-code-picker";
import { SalesmanSelect } from "@/components/forms/salesman-select";
import { LineItemsEditor, summarizeLines } from "@/components/trading/line-items-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import { createClient } from "@/lib/supabase/client";
import type { Party, Product, Warehouse } from "@/lib/types/database";
import type { SalesmanOption } from "@/lib/queries/salesmen";
import {
  type LineItemDraft,
  type PaymentType,
  calcLineDiscount,
} from "@/lib/types/trading";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function friendlyStockError(
  message: string,
  products: Product[],
  warehouses: Warehouse[],
) {
  return message.replace(UUID_RE, (id) => {
    const product = products.find((p) => p.id === id);
    if (product) return `${product.code} — ${product.name_en}`;
    const warehouse = warehouses.find((w) => w.id === id);
    if (warehouse) return warehouse.name;
    return id;
  });
}

export type StockBalanceLite = {
  product_id: string;
  warehouse_id: string;
  qty: number;
};

export function SaleInvoiceForm({
  companyId,
  organizationId,
  parties,
  products,
  warehouses,
  stockBalances = [],
  salesmen = [],
}: {
  companyId: string;
  organizationId: string;
  parties: Party[];
  products: Product[];
  warehouses: Warehouse[];
  stockBalances?: StockBalanceLite[];
  salesmen?: SalesmanOption[];
}) {
  const router = useRouter();
  const customers = useMemo(
    () => parties.filter((p) => p.party_subtype === "customer" || p.party_subtype === "both" || p.party_type === "PARTY"),
    [parties],
  );

  // product_id → warehouses that stock it, highest qty first
  const stockByProduct = useMemo(() => {
    const map = new Map<string, { warehouseId: string; qty: number }[]>();
    for (const row of stockBalances) {
      const qty = Number(row.qty);
      if (!(qty > 0)) continue;
      const list = map.get(row.product_id) || [];
      list.push({ warehouseId: row.warehouse_id, qty });
      map.set(row.product_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => b.qty - a.qty);
    return map;
  }, [stockBalances]);


  const [partyId, setPartyId] = useState("");
  const [salesmanId, setSalesmanId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentType, setPaymentType] = useState<PaymentType>("credit");
  const [walkInCustomer, setWalkInCustomer] = useState(false);
  const [narration, setNarration] = useState("");
  const [extraDiscount, setExtraDiscount] = useState("");
  const [lines, setLines] = useState<LineItemDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditWarning, setCreditWarning] = useState<string | null>(null);

  const party = customers.find((p) => p.id === partyId);
  const walkInActive = paymentType === "cash" && walkInCustomer;
  const customerRequired = !walkInActive;

  async function checkCreditLimit(nextPartyId: string) {
    setCreditWarning(null);
    if (!nextPartyId) return;
    const selected = customers.find((p) => p.id === nextPartyId);
    if (!selected || Number(selected.credit_limit) <= 0) return;

    const supabase = createClient();
    const { data: balance } = await supabase.rpc("get_party_balance", {
      p_company_id: companyId,
      p_party_id: nextPartyId,
      p_as_of: new Date().toISOString().slice(0, 10),
    });
    const bal = Number(balance || 0);
    if (bal >= Number(selected.credit_limit)) {
      setCreditWarning(
        `Credit limit reached/exceeded. Balance ${bal.toLocaleString()} / Limit ${Number(selected.credit_limit).toLocaleString()}`,
      );
    } else if (bal > Number(selected.credit_limit) * 0.85) {
      setCreditWarning(
        `Near credit limit. Balance ${bal.toLocaleString()} / Limit ${Number(selected.credit_limit).toLocaleString()}`,
      );
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);

    const valid = lines.filter((l) => l.product_id && Number(l.qty) > 0);
    const resolvedWarehouse =
      warehouseId ||
      products.find((p) => p.id === valid[0]?.product_id)?.default_warehouse_id ||
      "";
    if ((customerRequired && !partyId) || !resolvedWarehouse || valid.length === 0) {
      setError(
        customerRequired
          ? "Select customer, add a product line, and ensure company is set."
          : "Add a product line and ensure company is set.",
      );
      return;
    }

    setLoading(true);

    // Client-side stock check (qty + free) against each product's own company
    const needByProduct = new Map<string, number>();
    for (const l of valid) {
      const need = Number(l.qty || 0) + Number(l.bonus || 0);
      needByProduct.set(
        l.product_id,
        (needByProduct.get(l.product_id) || 0) + need,
      );
    }
    for (const [productId, need] of needByProduct) {
      const product = products.find((p) => p.id === productId);
      const stockWh = product?.default_warehouse_id || resolvedWarehouse;
      const onHand =
        stockByProduct
          .get(productId)
          ?.find((e) => e.warehouseId === stockWh)?.qty ?? 0;
      if (need > onHand + 1e-9) {
        const companyName =
          warehouses.find((w) => w.id === stockWh)?.name || "selected company";
        setLoading(false);
        setError(
          `${product ? `${product.code} — ${product.name_en}` : "Product"}: only ${onHand} available in ${companyName} (need ${need}).`,
        );
        return;
      }
    }

    const party = parties.find((p) => p.id === partyId);
    const { subtotal, discount_total, grand_total: linesTotal } = summarizeLines(valid);
    const extra = Math.max(0, Number(extraDiscount) || 0);
    if (extra > linesTotal + 0.005) {
      setLoading(false);
      setError("Extra discount cannot exceed the bill amount after trade discount.");
      return;
    }
    const grand_total = Math.max(0, linesTotal - extra);

    const amountPaid = paymentType === "cash" ? grand_total : 0;

    if (paymentType !== "cash" && party && Number(party.credit_limit) > 0) {
      const supabaseCheck = createClient();
      const { data: balance } = await supabaseCheck.rpc("get_party_balance", {
        p_company_id: companyId,
        p_party_id: partyId,
        p_as_of: invoiceDate,
      });
      const projected = Number(balance || 0) + grand_total - amountPaid;
      if (projected > Number(party.credit_limit)) {
        const proceed = window.confirm(
          `This sale may exceed credit limit.\nProjected balance: ${projected.toLocaleString()}\nLimit: ${Number(party.credit_limit).toLocaleString()}\n\nContinue anyway?`,
        );
        if (!proceed) {
          setLoading(false);
          return;
        }
      }
    }

    const supabase = createClient();

    const { data, error: rpcError } = await supabase.rpc("create_sale_invoice", {
      p_payload: {
        organization_id: organizationId,
        company_id: companyId,
        invoice_date: invoiceDate,
        party_id: partyId || null,
        walk_in: walkInActive,
        warehouse_id: resolvedWarehouse,
        salesman_id: salesmanId || null,
        route: party?.route || null,
        city: party?.city || null,
        payment_type: paymentType,
        amount_paid: amountPaid,
        subtotal,
        discount_total,
        extra_discount: extra,
        grand_total,
        narration,
        items: valid.map((l) => ({
          product_id: l.product_id,
          product_code: l.product_code,
          product_name: l.product_name,
          qty: Number(l.qty),
          bonus_qty: Number(l.bonus || 0),
          rate: Number(l.rate),
          discount: calcLineDiscount(l.qty, l.rate, l.discount),
          scheme: l.scheme || null,
          amount: l.amount,
        })),
      },
    });

    setLoading(false);
    if (rpcError) {
      setError(friendlyStockError(rpcError.message, products, warehouses));
      return;
    }

    router.push(`/sales/invoices/${data}`);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Date</Label>
          <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
        </div>
        <div className="sm:col-span-2 lg:col-span-2">
          <PartyCodePicker
            companyId={companyId}
            parties={customers}
            value={partyId}
            required={customerRequired}
            label="Customer code / shop"
            filterSubtype={["customer", "both"]}
            onChange={(id) => {
              setPartyId(id);
              if (id) setWalkInCustomer(false);
              void checkCreditLimit(id);
            }}
          />
        </div>
        <div>
          <SalesmanSelect
            salesmen={salesmen}
            value={salesmanId}
            onChange={setSalesmanId}
          />
        </div>
        <div>
          <Label>Payment</Label>
          <Select
            value={paymentType}
            onChange={(e) => {
              const next = (e.target.value as PaymentType) || "credit";
              setPaymentType(next);
              if (next !== "cash") setWalkInCustomer(false);
            }}
          >
            <option value="credit">Credit</option>
            <option value="cash">Cash</option>
          </Select>
          {paymentType === "cash" ? (
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-[var(--ink)]">
              <input
                type="checkbox"
                checked={walkInCustomer}
                onChange={(e) => {
                  const on = e.target.checked;
                  setWalkInCustomer(on);
                  if (on) {
                    setPartyId("");
                    setCreditWarning(null);
                  }
                }}
                className="h-4 w-4 rounded border-[var(--border)] accent-[var(--brand)]"
              />
              <span>Walk-in customer</span>
            </label>
          ) : null}
        </div>
        <div className="sm:col-span-2 lg:col-span-2">
          <Label>Narration</Label>
          <Input
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="Optional notes"
          />
        </div>
        <div>
          <Label>Company</Label>
          <Select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            options={[
              { value: "", label: "Auto from product" },
              ...warehouses.map((w) => ({
                value: w.id,
                label: w.name,
              })),
            ]}
          />
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Fills automatically when you pick a product.
          </p>
        </div>
      </div>

      <LineItemsEditor
        products={products}
        lines={lines}
        onChange={setLines}
        rateField="sale_rate"
        companyId={companyId}
        partyId={partyId}
        enableBonus
        warehouseId={warehouseId}
        warehouses={warehouses}
        stockByProduct={stockByProduct}
        onAutoPickWarehouse={setWarehouseId}
        extraDiscount={extraDiscount}
        onExtraDiscountChange={setExtraDiscount}
      />

      {creditWarning ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{creditWarning}</p>
      ) : null}

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <Button type="submit" disabled={loading}>
        {loading ? "Posting invoice..." : "Save & post sale invoice"}
      </Button>
    </form>
  );
}

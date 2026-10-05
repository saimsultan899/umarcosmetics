"use client";

import { PartyCodePicker } from "@/components/forms/party-code-picker";
import { SalesmanSelect } from "@/components/forms/salesman-select";
import { LineItemsEditor, summarizeLines, type LineItemsEditorHandle } from "@/components/trading/line-items-editor";
import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import { offlineAwareSubmit } from "@/lib/offline/offline-submit";
import { createClient } from "@/lib/supabase/client";
import type { Party, Product, Warehouse } from "@/lib/types/database";
import type { SalesmanOption } from "@/lib/queries/salesmen";
import {
  type LineItemDraft,
  type PaymentType,
  calcLineDiscount,
} from "@/lib/types/trading";
import { readWalkInSlip } from "@/lib/print/walk-in-slip";
import {
  normalizeSaleStockPolicy,
  reviewSaleStock,
  type SaleStockPolicy,
} from "@/lib/trading/sale-stock-policy";
import { formatNumber } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

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

export type SaleInvoiceEdit = {
  id: string;
  invoiceNo: string;
  partyId: string;
  salesmanId: string;
  warehouseId: string;
  invoiceDate: string;
  paymentType: PaymentType;
  amountPaid: number;
  walkIn: boolean;
  narration: string;
  extraDiscount: string;
  lines: LineItemDraft[];
  outstanding: number;
};

export function SaleInvoiceForm({
  companyId,
  organizationId,
  parties,
  products,
  warehouses,
  stockBalances = [],
  salesmen = [],
  saleStockPolicy = "confirm",
  editing,
  onDone,
}: {
  companyId: string;
  organizationId: string;
  parties: Party[];
  products: Product[];
  warehouses: Warehouse[];
  stockBalances?: StockBalanceLite[];
  salesmen?: SalesmanOption[];
  saleStockPolicy?: SaleStockPolicy;
  editing?: SaleInvoiceEdit;
  onDone?: () => void;
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  const linesEditorRef = useRef<LineItemsEditorHandle>(null);
  const [stockPolicy, setStockPolicy] = useState<SaleStockPolicy>(
    normalizeSaleStockPolicy(saleStockPolicy),
  );

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    void supabase
      .from("companies")
      .select("sale_stock_policy")
      .eq("id", companyId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) {
          setStockPolicy(normalizeSaleStockPolicy(data.sale_stock_policy));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);
  const customers = useMemo(
    () => parties.filter((p) => p.party_subtype === "customer" || p.party_subtype === "both" || p.party_type === "PARTY"),
    [parties],
  );

  // product_id → warehouses that stock it, highest qty first
  const stockByProduct = useMemo(() => {
    const map = new Map<string, { warehouseId: string; qty: number }[]>();
    for (const row of stockBalances) {
      const qty = Number(row.qty);
      if (!Number.isFinite(qty)) continue;
      const list = map.get(row.product_id) || [];
      list.push({ warehouseId: row.warehouse_id, qty });
      map.set(row.product_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => b.qty - a.qty);
    return map;
  }, [stockBalances]);


  const [partyId, setPartyId] = useState(editing?.partyId || "");
  const [salesmanId, setSalesmanId] = useState(editing?.salesmanId || "");
  const [warehouseId, setWarehouseId] = useState(editing?.warehouseId || "");
  const [invoiceDate, setInvoiceDate] = useState(
    editing?.invoiceDate || new Date().toISOString().slice(0, 10),
  );
  const [paymentType, setPaymentType] = useState<PaymentType>(
    editing?.paymentType === "partial" || editing?.paymentType === "cash"
      ? "cash"
      : editing?.paymentType || "credit",
  );
  const [walkInCustomer, setWalkInCustomer] = useState(Boolean(editing?.walkIn));
  const [narration, setNarration] = useState(editing?.narration || "");
  const [extraDiscount, setExtraDiscount] = useState(editing?.extraDiscount || "");
  const [lines, setLines] = useState<LineItemDraft[]>(editing?.lines || []);
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
        `Credit limit reached/exceeded. Balance ${formatNumber(bal)} / Limit ${formatNumber(selected.credit_limit)}`,
      );
    } else if (bal > Number(selected.credit_limit) * 0.85) {
      setCreditWarning(
        `Near credit limit. Balance ${formatNumber(bal)} / Limit ${formatNumber(selected.credit_limit)}`,
      );
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);

    const flushed = linesEditorRef.current?.flush() || lines;
    const valid = flushed.filter((l) => l.product_id && Number(l.qty) > 0);
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

    const stockAlerts: string[] = [];
    const needByProduct = new Map<string, number>();
    for (const l of valid) {
      const need = Number(l.qty || 0) + Number(l.bonus || 0);
      needByProduct.set(
        l.product_id,
        (needByProduct.get(l.product_id) || 0) + need,
      );
    }
    const restoredByProduct = new Map<string, number>();
    if (editing) {
      for (const line of editing.lines) {
        restoredByProduct.set(
          line.product_id,
          (restoredByProduct.get(line.product_id) || 0) +
            Number(line.qty || 0) +
            Number(line.bonus || 0),
        );
      }
    }
    for (const [productId, need] of needByProduct) {
      const product = products.find((p) => p.id === productId);
      const stockWh = product?.default_warehouse_id || resolvedWarehouse;
      const onHand =
        (stockByProduct
          .get(productId)
          ?.find((e) => e.warehouseId === stockWh)?.qty ?? 0) +
        (restoredByProduct.get(productId) || 0);
      if (need > onHand + 1e-9) {
        const companyName =
          warehouses.find((w) => w.id === stockWh)?.name || "selected company";
        const label = product
          ? `${product.code} — ${product.name_en}`
          : "Product";
        stockAlerts.push(
          `${label} is out of stock in ${companyName} (on hand ${onHand}, selling ${need}).`,
        );
      }
    }
    const stockReview = reviewSaleStock(
      [...needByProduct.entries()].map(([productId, need]) => {
        const product = products.find((p) => p.id === productId);
        const stockWh = product?.default_warehouse_id || resolvedWarehouse;
        const onHand =
          (stockByProduct
            .get(productId)
            ?.find((e) => e.warehouseId === stockWh)?.qty ?? 0) +
          (restoredByProduct.get(productId) || 0);
        const companyName =
          warehouses.find((w) => w.id === stockWh)?.name || "selected company";
        const label = product
          ? `${product.code} — ${product.name_en} (${companyName})`
          : "Product";
        return { label, need, onHand };
      }),
      stockPolicy,
    );
    if (stockReview.mistakes.length > 0) {
      setError(
        `${stockReview.mistakes.join("\n")}\n\nThis quantity is too far above the stock on hand. The invoice was not saved.`,
      );
      return;
    }
    if (stockPolicy === "block" && stockReview.shorts.length > 0) {
      setError(
        `${stockReview.shorts.join("\n")}\n\nThis company does not sell more than the stock on hand.`,
      );
      return;
    }
    if (stockAlerts.length > 0 && stockPolicy === "confirm") {
      const proceed = window.confirm(
        `Out of stock:\n\n${stockAlerts.join("\n")}\n\nSave this sale anyway? Stock will go negative, and the next receipt will clear that deficit.`,
      );
      if (!proceed) return;
    }

    setLoading(true);

    const party = parties.find((p) => p.id === partyId);
    const { subtotal, discount_total, grand_total: linesTotal } = summarizeLines(valid);
    const extra = Math.max(0, Number(extraDiscount) || 0);
    if (extra > linesTotal + 0.005) {
      setLoading(false);
      setError("Extra discount cannot exceed the bill amount after trade discount.");
      return;
    }
    const grand_total = Math.max(0, linesTotal - extra);

    const resolvedPayment: PaymentType = paymentType === "cash" ? "cash" : "credit";
    const amountPaid = resolvedPayment === "cash" ? grand_total : 0;

    if (grand_total - amountPaid > 0.005 && party && Number(party.credit_limit) > 0) {
      // Skip cloud balance check when offline — don't block local save.
      if (typeof navigator === "undefined" || navigator.onLine) {
        try {
          const supabaseCheck = createClient();
          const balanceResult = await Promise.race([
            supabaseCheck.rpc("get_party_balance", {
              p_company_id: companyId,
              p_party_id: partyId,
              p_as_of: invoiceDate,
            }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
          ]);
          const balance =
            balanceResult && "data" in balanceResult ? balanceResult.data : null;
          const alreadyBooked =
            editing && editing.partyId === partyId ? editing.outstanding : 0;
          const projected =
            Number(balance || 0) - alreadyBooked + grand_total - amountPaid;
          if (projected > Number(party.credit_limit)) {
            const proceed = window.confirm(
              `This sale may exceed credit limit.\nProjected balance: ${formatNumber(projected)}\nLimit: ${formatNumber(party.credit_limit)}\n\nContinue anyway?`,
            );
            if (!proceed) {
              setLoading(false);
              return;
            }
          }
        } catch {
          /* ignore credit check failures; allow save */
        }
      }
    }

    try {
      const oldNeed = new Map<string, number>();
      if (editing) {
        for (const line of editing.lines) {
          oldNeed.set(
            line.product_id,
            (oldNeed.get(line.product_id) || 0) +
              Number(line.qty || 0) +
              Number(line.bonus || 0),
          );
        }
      }
      const stockIds = new Set<string>([
        ...oldNeed.keys(),
        ...valid.map((l) => l.product_id),
      ]);
      const stockChanges = [...stockIds].map((productId) => ({
        productId,
        warehouseId:
          products.find((p) => p.id === productId)?.default_warehouse_id ||
          resolvedWarehouse,
        delta:
          (oldNeed.get(productId) || 0) - (needByProduct.get(productId) || 0),
      }));

      const res = await offlineAwareSubmit({
        mutationType: editing ? "sale_invoice_update" : "sale_invoice",
        companyId,
        organizationId,
        stockChanges,
        payload: {
          ...(editing
            ? { invoice_id: editing.id, invoice_no: editing.invoiceNo }
            : {}),
          organization_id: organizationId,
          company_id: companyId,
          invoice_date: invoiceDate,
          party_id: partyId || null,
          party_name: party?.name_en || (walkInActive ? "Walk-in Customer" : null),
          party_code: party?.party_code || (walkInActive ? "WALKIN" : null),
          parties: party
            ? {
                name_en: party.name_en,
                party_code: party.party_code,
                address: party.address,
                city: party.city,
                phone: party.phone,
                mobile: party.mobile,
                contact_person: party.contact_person,
                route: party.route,
                head: party.head,
              }
            : walkInActive
              ? { name_en: "Walk-in Customer", party_code: "WALKIN" }
              : null,
          walk_in: walkInActive,
          warehouse_id: resolvedWarehouse,
          salesman_id: salesmanId || null,
          route: party?.route || null,
          city: party?.city || null,
          payment_type: resolvedPayment,
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
      closeDialog?.();
      onDone?.();
      if (editing) {
        router.refresh();
        return;
      }
      const printThermal =
        walkInActive && readWalkInSlip(companyId) === "thermal";
      if (res.source === "offline" && !printThermal) {
        router.refresh();
      } else {
        router.push(
          `/sales/invoices/${res.id}${printThermal ? "?print=1" : ""}`,
        );
        router.refresh();
      }
    } catch (err: any) {
      setLoading(false);
      setError(friendlyStockError(err?.message || String(err), products, warehouses));
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >
      <div className="grid items-start gap-2 sm:grid-cols-12">
        <div className="sm:col-span-2">
          <Label>Date</Label>
          <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
        </div>
        <div className="sm:col-span-6">
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
        <div className="sm:col-span-4">
          <div className="flex items-end gap-3">
            <div className="w-40 shrink-0">
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
                <option value="cash">Paid</option>
              </Select>
            </div>
            {paymentType === "cash" ? (
              <label className="mb-2.5 flex cursor-pointer items-center gap-2 text-sm text-[var(--ink)]">
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
        </div>
        <div className={salesmen.length ? "sm:col-span-6" : "sm:col-span-8"}>
          <Label>Narration</Label>
          <Input
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="Optional notes"
          />
        </div>
        {salesmen.length ? (
          <div className="sm:col-span-2">
            <SalesmanSelect
              salesmen={salesmen}
              value={salesmanId}
              onChange={setSalesmanId}
              hideHint
            />
          </div>
        ) : null}
        <div className="sm:col-span-4" title="Fills automatically when you pick a product.">
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
        </div>
      </div>

      <LineItemsEditor
        ref={linesEditorRef}
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
        allowOversell={stockPolicy === "confirm"}
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

      <Button type="submit" loading={loading}>
        {loading
          ? editing
            ? "Updating invoice..."
            : "Posting invoice..."
          : editing
            ? "Update sale invoice"
            : "Save & post sale invoice"}
      </Button>
    </form>
  );
}

"use client";

import { PartyCodePicker } from "@/components/forms/party-code-picker";
import { SalesmanSelect } from "@/components/forms/salesman-select";
import { PurchaseInvoiceForm } from "@/components/trading/purchase-invoice-form";
import { ReturnForm } from "@/components/trading/return-form";
import { SaleInvoiceForm } from "@/components/trading/sale-invoice-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JournalVoucherForm } from "@/components/vouchers/journal-form";
import { CashVoucherForm } from "@/components/vouchers/voucher-lines-form";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import { offlineAwareSubmit } from "@/lib/offline/offline-submit";
import { createClient } from "@/lib/supabase/client";
import { useTradingCatalog } from "@/lib/trading/catalog-client";
import type { LineItemDraft, PaymentType } from "@/lib/types/trading";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

const WIDE_TABLES = new Set([
  "sale_invoices",
  "purchase_invoices",
  "sale_returns",
  "purchase_returns",
]);

export function postedEditIsWide(table: string) {
  return WIDE_TABLES.has(table);
}

function asDate(value: unknown) {
  return String(value || "").slice(0, 10);
}

function discountPercent(qty: number, rate: number, discountAmount: number) {
  const gross = qty * rate;
  if (!(gross > 0) || !(discountAmount > 0)) return "0";
  return String(Math.round((discountAmount / gross) * 10000) / 100);
}

function toLines(
  rows: Array<Record<string, unknown>>,
  withBonus: boolean,
): LineItemDraft[] {
  return [...rows]
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((row) => {
      const qty = Number(row.qty || 0);
      const rate = Number(row.rate || 0);
      const bonus = withBonus ? Number(row.bonus_qty || 0) : 0;
      const discount = discountPercent(qty, rate, Number(row.discount || 0));
      return {
        key: crypto.randomUUID(),
        product_id: String(row.product_id || ""),
        product_code: String(row.product_code || ""),
        product_name: String(row.product_name || ""),
        qty: String(qty),
        bonus: bonus > 0 ? String(bonus) : "0",
        rate: String(rate),
        discount,
        scheme: String(row.scheme || ""),
        amount: Number(row.amount || 0),
      };
    });
}

export function PostedDocumentEditor({
  table,
  id,
  onDone,
}: {
  table: string;
  id: string;
  onDone: () => void;
}) {
  const [companyId, setCompanyId] = useState("");
  const [doc, setDoc] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setError(null);
    setCompanyId("");
    void (async () => {
      try {
        const loaded = await loadPostedDocument(table, id);
        if (cancelled) return;
        setCompanyId(String(loaded.company_id || ""));
        setDoc(loaded);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not open this entry");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [table, id]);

  const catalog = useTradingCatalog(companyId, {
    enabled: Boolean(companyId),
    stock: table === "sale_invoices",
    salesmen: table === "sale_invoices" || table === "recoveries",
  });

  if (error) {
    return <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>;
  }
  if (!doc || !catalog.ready) {
    return <p className="py-8 text-center text-sm text-[var(--muted)]">Opening entry…</p>;
  }
  if (catalog.error) {
    return (
      <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{catalog.error}</p>
    );
  }

  const organizationId = String(doc.organization_id || "");

  if (table === "sale_invoices") {
    const items = Array.isArray(doc.sale_invoice_items)
      ? (doc.sale_invoice_items as Array<Record<string, unknown>>)
      : [];
    const party = doc.parties as { party_code?: string } | null;
    const payment = String(doc.payment_type || "credit") as PaymentType;
    const grand = Number(doc.grand_total || 0);
    const paid = Number(doc.amount_paid || 0);
    return (
      <SaleInvoiceForm
        companyId={companyId}
        organizationId={organizationId}
        parties={catalog.parties}
        products={catalog.products}
        warehouses={catalog.warehouses}
        stockBalances={catalog.stockBalances}
        salesmen={catalog.salesmen}
        editing={{
          id,
          invoiceNo: String(doc.invoice_no || ""),
          partyId: String(doc.party_id || ""),
          salesmanId: String(doc.salesman_id || ""),
          warehouseId: String(doc.warehouse_id || ""),
          invoiceDate: asDate(doc.invoice_date),
          paymentType: payment,
          amountPaid: paid,
          walkIn: String(party?.party_code || "").toUpperCase() === "WALKIN",
          narration: String(doc.narration || ""),
          extraDiscount: String(Number(doc.extra_discount || 0) || ""),
          lines: toLines(items, true),
          outstanding: Math.max(0, grand - paid),
        }}
        onDone={onDone}
      />
    );
  }

  if (table === "purchase_invoices") {
    const items = Array.isArray(doc.purchase_invoice_items)
      ? (doc.purchase_invoice_items as Array<Record<string, unknown>>)
      : [];
    return (
      <PurchaseInvoiceForm
        companyId={companyId}
        organizationId={organizationId}
        parties={catalog.parties}
        products={catalog.products}
        warehouses={catalog.warehouses}
        editing={{
          id,
          invoiceNo: String(doc.invoice_no || ""),
          partyId: String(doc.party_id || ""),
          warehouseId: String(doc.warehouse_id || ""),
          invoiceDate: asDate(doc.invoice_date),
          supplierBillNo: String(doc.supplier_bill_no || ""),
          narration: String(doc.narration || ""),
          extraDiscount: String(Number(doc.extra_discount || 0) || ""),
          lines: toLines(items, false),
        }}
        onDone={onDone}
      />
    );
  }

  if (table === "sale_returns" || table === "purchase_returns") {
    const key = table === "sale_returns" ? "sale_return_items" : "purchase_return_items";
    const items = Array.isArray(doc[key])
      ? (doc[key] as Array<Record<string, unknown>>)
      : [];
    const kind = table === "sale_returns" ? "sale" : "purchase";
    return (
      <ReturnForm
        kind={kind}
        companyId={companyId}
        organizationId={organizationId}
        parties={catalog.parties}
        products={catalog.products}
        warehouses={catalog.warehouses}
        editing={{
          id,
          returnNo: String(doc.return_no || ""),
          partyId: String(doc.party_id || ""),
          warehouseId: String(doc.warehouse_id || ""),
          returnDate: asDate(doc.return_date),
          narration: String(doc.narration || ""),
          extraDiscount: String(Number(doc.extra_discount || 0) || ""),
          invoiceId:
            kind === "sale"
              ? (doc.sale_invoice_id as string | null)
              : (doc.purchase_invoice_id as string | null),
          lines: toLines(items, kind === "sale"),
          grandTotal: Number(doc.grand_total || 0),
        }}
        onDone={onDone}
      />
    );
  }

  if (table === "vouchers") {
    const kind = String(doc.voucher_type || "");
    const lines = Array.isArray(doc.voucher_lines)
      ? [...(doc.voucher_lines as Array<Record<string, unknown>>)].sort(
          (a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0),
        )
      : [];
    if (kind === "CR" || kind === "CP") {
      return (
        <CashVoucherForm
          kind={kind}
          companyId={companyId}
          organizationId={organizationId}
          parties={catalog.parties}
          editing={{
            id,
            voucherNo: String(doc.voucher_no || ""),
            date: asDate(doc.voucher_date),
            narration: String(doc.narration || ""),
            lines: lines.map((line) => ({
              party_id: String(line.party_id || ""),
              amount: String(line.amount || ""),
              narration: String(line.narration || ""),
            })),
          }}
          onDone={onDone}
        />
      );
    }
    if (kind === "JV") {
      return (
        <JournalVoucherForm
          companyId={companyId}
          organizationId={organizationId}
          parties={catalog.parties}
          editing={{
            id,
            voucherNo: String(doc.voucher_no || ""),
            date: asDate(doc.voucher_date),
            narration: String(doc.narration || ""),
            lines: lines.map((line) => ({
              debit_party_id: String(line.debit_party_id || ""),
              credit_party_id: String(line.credit_party_id || ""),
              amount: String(line.amount || ""),
              narration: String(line.narration || ""),
            })),
          }}
          onDone={onDone}
        />
      );
    }
  }

  if (table === "recoveries") {
    return (
      <RecoveryEditForm
        companyId={companyId}
        organizationId={organizationId}
        parties={catalog.parties}
        salesmen={catalog.salesmen}
        doc={doc}
        onDone={onDone}
      />
    );
  }

  return <p className="text-sm text-[var(--muted)]">This entry cannot be edited here.</p>;
}

function RecoveryEditForm({
  companyId,
  organizationId,
  parties,
  salesmen,
  doc,
  onDone,
}: {
  companyId: string;
  organizationId: string;
  parties: import("@/lib/types/database").Party[];
  salesmen: import("@/lib/queries/salesmen").SalesmanOption[];
  doc: Record<string, unknown>;
  onDone: () => void;
}) {
  const [partyId, setPartyId] = useState(String(doc.party_id || ""));
  const [date, setDate] = useState(asDate(doc.recovery_date));
  const [amount, setAmount] = useState(String(doc.amount || ""));
  const [remarks, setRemarks] = useState(String(doc.remarks || ""));
  const [salesmanId, setSalesmanId] = useState(String(doc.salesman_id || ""));
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const value = Number(amount);
    if (!partyId || !(value > 0)) {
      setError("Select the customer and enter the amount received.");
      return;
    }
    const party = parties.find((p) => p.id === partyId);
    setLoading(true);
    try {
      await offlineAwareSubmit({
        mutationType: "recovery_update",
        companyId,
        organizationId,
        payload: {
          recovery_id: doc.id,
          organization_id: organizationId,
          company_id: companyId,
          party_id: partyId,
          recovery_date: date,
          amount: value,
          remarks,
          salesman_id: salesmanId || null,
          route: party?.route || null,
          city: party?.city || null,
        },
      });
      setLoading(false);
      onDone();
      router.refresh();
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div>
          <Label>Amount</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <PartyCodePicker
            companyId={companyId}
            parties={parties}
            value={partyId}
            required
            label="Customer code / shop"
            filterSubtype={["customer", "both"]}
            onChange={setPartyId}
          />
        </div>
        <div>
          <SalesmanSelect salesmen={salesmen} value={salesmanId} onChange={setSalesmanId} />
        </div>
        <div>
          <Label>Remarks</Label>
          <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
      </div>
      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" loading={loading}>
          {loading ? "Updating..." : "Update recovery"}
        </Button>
      </div>
    </form>
  );
}

async function loadPostedDocument(table: string, id: string) {
  const supabase = createClient();
  const select =
    table === "sale_invoices"
      ? "*, parties(party_code), sale_invoice_items(*)"
      : table === "purchase_invoices"
        ? "*, purchase_invoice_items(*)"
        : table === "sale_returns"
          ? "*, sale_return_items(*)"
          : table === "purchase_returns"
            ? "*, purchase_return_items(*)"
            : table === "vouchers"
              ? "*, voucher_lines(*)"
              : table === "recoveries"
                ? "*"
                : "*";
  const { data, error } = await (
    supabase.from(table as "sale_invoices") as unknown as {
      select: (columns: string) => {
        eq: (
          column: string,
          value: string,
        ) => {
          maybeSingle: () => Promise<{
            data: Record<string, unknown> | null;
            error: { message: string } | null;
          }>;
        };
      };
    }
  )
    .select(select)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Entry not found");
  return data;
}

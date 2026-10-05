"use client";

import {
  LineItemsEditor,
  summarizeLines,
  type LineItemsEditorHandle,
} from "@/components/trading/line-items-editor";
import { PartyCodePicker } from "@/components/forms/party-code-picker";
import { Button } from "@/components/ui/button";
import { useCreateDialogClose } from "@/components/ui/create-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { handleEnterAsNext } from "@/lib/keyboard/enter-nav";
import { getCachedRows } from "@/lib/offline/local-db";
import { isAppOnline } from "@/lib/offline/local-auth";
import { offlineAwareSubmit } from "@/lib/offline/offline-submit";
import { createClient } from "@/lib/supabase/client";
import type { Party, Product, Warehouse } from "@/lib/types/database";
import { type LineItemDraft, calcLineAmount, calcLineDiscount } from "@/lib/types/trading";
import { formatPkr } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type ReturnInvoice = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  warehouse_id: string;
  extra_discount: number;
  items: Array<{
    product_id: string;
    product_code: string;
    product_name: string;
    qty: number;
    bonus: number;
    rate: number;
    discount: number;
  }>;
};

function num(value: unknown) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function discountPercent(qty: number, rate: number, discountAmount: number) {
  const gross = qty * rate;
  if (!(gross > 0) || !(discountAmount > 0)) return "0";
  return String(Math.round((discountAmount / gross) * 10000) / 100);
}

async function loadPartyInvoices(companyId: string, partyId: string) {
  const online = await isAppOnline();
  if (online) {
    const supabase = createClient();
    const { data: sales } = await supabase
      .from("sale_invoices")
      .select(
        "id, invoice_no, invoice_date, warehouse_id, extra_discount, sale_invoice_items(product_id, product_code, product_name, qty, bonus_qty, rate, discount)",
      )
      .eq("company_id", companyId)
      .eq("party_id", partyId)
      .eq("status", "posted")
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(40);
    const ids = (sales || []).map((row) => row.id as string);
    const returned = new Map<string, { extra: number; qty: Map<string, { qty: number; bonus: number }> }>();
    if (ids.length) {
      const { data: prior } = await supabase
        .from("sale_returns")
        .select("sale_invoice_id, extra_discount, sale_return_items(product_id, qty, bonus_qty)")
        .eq("company_id", companyId)
        .eq("status", "posted")
        .in("sale_invoice_id", ids);
      for (const row of prior || []) {
        const invoiceId = row.sale_invoice_id as string;
        const bucket = returned.get(invoiceId) || {
          extra: 0,
          qty: new Map<string, { qty: number; bonus: number }>(),
        };
        bucket.extra += num(row.extra_discount);
        const items = (row.sale_return_items || []) as Array<{
          product_id: string;
          qty: number;
          bonus_qty: number;
        }>;
        for (const item of items) {
          const cur = bucket.qty.get(item.product_id) || { qty: 0, bonus: 0 };
          cur.qty += num(item.qty);
          cur.bonus += num(item.bonus_qty);
          bucket.qty.set(item.product_id, cur);
        }
        returned.set(invoiceId, bucket);
      }
    }
    return (sales || []).map((row) =>
      toReturnInvoice(row as Record<string, unknown>, returned.get(row.id as string)),
    ).filter((inv) => inv.items.some((item) => item.qty > 0 || item.bonus > 0));
  }

  const [sales, returns] = await Promise.all([
    getCachedRows("sale_invoices", companyId),
    getCachedRows("sale_returns", companyId),
  ]);
  const returned = new Map<string, { extra: number; qty: Map<string, { qty: number; bonus: number }> }>();
  for (const row of returns) {
    const invoiceId = String(row.sale_invoice_id || "");
    if (!invoiceId || String(row.party_id || "") !== partyId) continue;
    if (String(row.status || "posted") === "cancelled") continue;
    const bucket = returned.get(invoiceId) || {
      extra: 0,
      qty: new Map<string, { qty: number; bonus: number }>(),
    };
    bucket.extra += num(row.extra_discount);
    const items = (Array.isArray(row.sale_return_items) ? row.sale_return_items : row.items) as
      | Array<Record<string, unknown>>
      | undefined;
    for (const item of items || []) {
      const productId = String(item.product_id || "");
      if (!productId) continue;
      const cur = bucket.qty.get(productId) || { qty: 0, bonus: 0 };
      cur.qty += num(item.qty);
      cur.bonus += num(item.bonus_qty || item.bonus);
      bucket.qty.set(productId, cur);
    }
    returned.set(invoiceId, bucket);
  }
  return sales
    .filter((row) => String(row.party_id || "") === partyId && String(row.status || "posted") !== "cancelled")
    .map((row) => toReturnInvoice(row, returned.get(String(row.id || ""))))
    .filter((inv) => inv.items.some((item) => item.qty > 0 || item.bonus > 0))
    .sort((a, b) => b.invoice_date.localeCompare(a.invoice_date))
    .slice(0, 40);
}

function toReturnInvoice(
  row: Record<string, unknown>,
  prior?: { extra: number; qty: Map<string, { qty: number; bonus: number }> },
): ReturnInvoice {
  const rawItems = (Array.isArray(row.sale_invoice_items) ? row.sale_invoice_items : []) as Array<
    Record<string, unknown>
  >;
  const grouped = new Map<string, ReturnInvoice["items"][number]>();
  for (const item of rawItems) {
    const productId = String(item.product_id || "");
    if (!productId) continue;
    const cur = grouped.get(productId) || {
      product_id: productId,
      product_code: String(item.product_code || ""),
      product_name: String(item.product_name || ""),
      qty: 0,
      bonus: 0,
      rate: num(item.rate),
      discount: 0,
    };
    cur.qty += num(item.qty);
    cur.bonus += num(item.bonus_qty);
    cur.discount += num(item.discount);
    if (!cur.rate) cur.rate = num(item.rate);
    grouped.set(productId, cur);
  }
  const items = [...grouped.values()].map((item) => {
    const used = prior?.qty.get(item.product_id);
    return {
      ...item,
      qty: Math.max(0, item.qty - (used?.qty || 0)),
      bonus: Math.max(0, item.bonus - (used?.bonus || 0)),
      discount:
        item.qty > 0
          ? item.discount * (Math.max(0, item.qty - (used?.qty || 0)) / item.qty)
          : 0,
    };
  });
  return {
    id: String(row.id || ""),
    invoice_no: String(row.invoice_no || ""),
    invoice_date: String(row.invoice_date || ""),
    warehouse_id: String(row.warehouse_id || ""),
    extra_discount: Math.max(0, num(row.extra_discount) - (prior?.extra || 0)),
    items,
  };
}

export type ReturnEdit = {
  id: string;
  returnNo: string;
  partyId: string;
  warehouseId: string;
  returnDate: string;
  narration: string;
  extraDiscount: string;
  invoiceId: string | null;
  lines: LineItemDraft[];
  grandTotal: number;
};

export function ReturnForm({
  kind,
  companyId,
  organizationId,
  parties,
  products,
  warehouses,
  editing,
  onDone,
}: {
  kind: "sale" | "purchase";
  companyId: string;
  organizationId: string;
  parties: Party[];
  products: Product[];
  warehouses: Warehouse[];
  editing?: ReturnEdit;
  onDone?: () => void;
}) {
  const router = useRouter();
  const closeDialog = useCreateDialogClose();
  const linesEditorRef = useRef<LineItemsEditorHandle>(null);
  const partyOptions = useMemo(() => {
    if (kind === "purchase") {
      return parties.filter(
        (p) =>
          p.party_subtype === "supplier" ||
          p.party_subtype === "both" ||
          p.party_type === "PARTY",
      );
    }
    return parties.filter(
      (p) =>
        p.party_subtype === "customer" ||
        p.party_subtype === "both" ||
        p.party_type === "PARTY",
    );
  }, [kind, parties]);

  const [partyId, setPartyId] = useState(editing?.partyId || "");
  const [warehouseId, setWarehouseId] = useState(
    editing?.warehouseId || warehouses[0]?.id || "",
  );
  const [returnDate, setReturnDate] = useState(
    editing?.returnDate || new Date().toISOString().slice(0, 10),
  );
  const [narration, setNarration] = useState(editing?.narration || "");
  const [extraDiscount, setExtraDiscount] = useState(editing?.extraDiscount || "");
  const [lines, setLines] = useState<LineItemDraft[]>(editing?.lines || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<ReturnInvoice[]>([]);
  const [invoiceId, setInvoiceId] = useState(editing?.invoiceId || "");
  const [caps, setCaps] = useState<Map<string, { qty: number; bonus: number }>>(new Map());
  const [partyDue, setPartyDue] = useState<number | null>(null);
  const [recoveredTotal, setRecoveredTotal] = useState(0);
  const extraEdited = useRef(Boolean(editing));
  const invoiceBasis = useRef<{ extra: number; linesTotal: number } | null>(null);
  const preserveEdit = useRef(Boolean(editing));
  const editingRef = useRef(editing);
  editingRef.current = editing;

  useEffect(() => {
    if (kind !== "sale") return;
    const keep = preserveEdit.current;
    preserveEdit.current = false;
    if (!keep) {
      extraEdited.current = false;
      invoiceBasis.current = null;
      setInvoiceId("");
      setCaps(new Map());
      setLines([]);
      setExtraDiscount("");
    }
    setInvoices([]);
    if (!partyId) return;

    let cancelled = false;
    void (async () => {
      const loaded = await loadPartyInvoices(companyId, partyId);
      if (cancelled) return;
      setInvoices(loaded);
      const current = editingRef.current;
      if (!keep || !current?.invoiceId) return;
      setInvoiceId(current.invoiceId);
      const invoice = loaded.find((inv) => inv.id === current.invoiceId);
      const nextCaps = new Map<string, { qty: number; bonus: number }>();
      if (invoice) {
        for (const item of invoice.items) {
          nextCaps.set(item.product_id, { qty: item.qty, bonus: item.bonus });
        }
      }
      for (const line of current.lines) {
        const cur = nextCaps.get(line.product_id) || { qty: 0, bonus: 0 };
        nextCaps.set(line.product_id, {
          qty: cur.qty + Number(line.qty || 0),
          bonus: cur.bonus + Number(line.bonus || 0),
        });
      }
      setCaps(nextCaps);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, kind, partyId]);

  useEffect(() => {
    if (kind !== "sale" || !partyId) {
      setPartyDue(null);
      setRecoveredTotal(0);
      return;
    }
    let cancelled = false;
    void (async () => {
      if (!(await isAppOnline())) {
        if (!cancelled) {
          setPartyDue(null);
          setRecoveredTotal(0);
        }
        return;
      }
      try {
        const supabase = createClient();
        const [{ data: bal }, { data: recs }] = await Promise.all([
          supabase.rpc("get_party_balance", {
            p_company_id: companyId,
            p_party_id: partyId,
            p_as_of: returnDate,
          }),
          supabase
            .from("recoveries")
            .select("amount")
            .eq("company_id", companyId)
            .eq("party_id", partyId)
            .gt("amount", 0)
            .lte("recovery_date", returnDate),
        ]);
        if (cancelled) return;
        setPartyDue(bal == null ? null : Number(bal));
        setRecoveredTotal(
          (recs || []).reduce((sum, row) => sum + Number(row.amount || 0), 0),
        );
      } catch {
        if (!cancelled) {
          setPartyDue(null);
          setRecoveredTotal(0);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, kind, partyId, returnDate]);

  function applyInvoice(nextId: string) {
    setInvoiceId(nextId);
    extraEdited.current = false;
    const invoice = invoices.find((inv) => inv.id === nextId);
    if (!invoice) {
      invoiceBasis.current = null;
      setCaps(new Map());
      setLines([]);
      setExtraDiscount("");
      return;
    }
    if (invoice.warehouse_id) setWarehouseId(invoice.warehouse_id);
    const nextCaps = new Map<string, { qty: number; bonus: number }>();
    const nextLines: LineItemDraft[] = [];
    for (const item of invoice.items) {
      if (!(item.qty > 0) && !(item.bonus > 0)) continue;
      nextCaps.set(item.product_id, { qty: item.qty, bonus: item.bonus });
      const qty = String(item.qty);
      const discount = discountPercent(item.qty, item.rate, item.discount);
      const bonus = item.bonus > 0 ? String(item.bonus) : "0";
      nextLines.push({
        key: crypto.randomUUID(),
        product_id: item.product_id,
        product_code: item.product_code,
        product_name: item.product_name,
        qty,
        bonus,
        rate: String(item.rate),
        discount,
        scheme: item.bonus > 0 ? `+${item.bonus}` : "",
        amount: calcLineAmount(qty, String(item.rate), discount),
      });
    }
    const linesTotal = nextLines.reduce((s, l) => s + l.amount, 0);
    invoiceBasis.current = { extra: invoice.extra_discount, linesTotal };
    setCaps(nextCaps);
    setLines(nextLines);
    setExtraDiscount(
      linesTotal > 0 ? String(Math.min(invoice.extra_discount, linesTotal)) : "0",
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const flushed = linesEditorRef.current?.flush() || lines;
    const valid = flushed.filter(
      (l) => l.product_id && (Number(l.qty) > 0 || Number(l.bonus || 0) > 0),
    );
    if (!partyId || !warehouseId || valid.length === 0) {
      setError(
        kind === "purchase"
          ? "Select vendor, company, and at least one line (Enter/Add on the draft row)."
          : "Select customer, company, and at least one line (Enter/Add on the draft row).",
      );
      return;
    }

    const { subtotal, discount_total, grand_total: linesTotal } = summarizeLines(valid);
    const extra = Math.max(0, Number(extraDiscount) || 0);
    if (extra > linesTotal + 0.005) {
      setError("Extra discount cannot exceed the bill amount after trade discount.");
      return;
    }
    if (kind === "sale" && invoiceId) {
      for (const line of valid) {
        const cap = caps.get(line.product_id);
        if (!cap) {
          setError(`${line.product_name || line.product_code} is not on that sale invoice.`);
          return;
        }
        if (Number(line.qty) > cap.qty + 0.0005) {
          setError(
            `Return qty for ${line.product_name || line.product_code} is more than that invoice still has (${cap.qty}).`,
          );
          return;
        }
        if (Number(line.bonus || 0) > cap.bonus + 0.0005) {
          setError(
            `Return free qty for ${line.product_name || line.product_code} is more than that invoice still has (${cap.bonus}).`,
          );
          return;
        }
      }
    }
    const grand_total = Math.max(0, linesTotal - extra);

    const dueForCheck =
      partyDue == null
        ? null
        : partyDue +
          (editing && partyId === editing.partyId ? editing.grandTotal : 0);
    if (kind === "sale" && dueForCheck != null && grand_total > dueForCheck + 0.005) {
      const recoveryNote =
        recoveredTotal > 0.005
          ? ` Recoveries already recorded: ${formatPkr(recoveredTotal)}.`
          : "";
      if (dueForCheck <= 0.005) {
        setError(
          `This customer has no amount due. A sale return would create credit. Cancel the recovery first if goods are coming back.${recoveryNote}`,
        );
      } else {
        setError(
          `This customer only owes ${formatPkr(dueForCheck)}. A return of ${formatPkr(grand_total)} would create credit. Cancel the recovery first, or return only the unpaid amount.${recoveryNote}`,
        );
      }
      return;
    }

    setLoading(true);
    try {
      const signedNeed = (qty: number, bonus: number) =>
        kind === "sale" ? qty + bonus : -(qty + bonus);
      const oldNeed = new Map<string, number>();
      if (editing) {
        for (const line of editing.lines) {
          oldNeed.set(
            line.product_id,
            (oldNeed.get(line.product_id) || 0) +
              signedNeed(Number(line.qty || 0), Number(line.bonus || 0)),
          );
        }
      }
      const newNeed = new Map<string, number>();
      for (const line of valid) {
        newNeed.set(
          line.product_id,
          (newNeed.get(line.product_id) || 0) +
            signedNeed(Number(line.qty || 0), Number(line.bonus || 0)),
        );
      }
      const stockIds = new Set<string>([...oldNeed.keys(), ...newNeed.keys()]);
      const stockChanges = [...stockIds].map((productId) => ({
        productId,
        warehouseId,
        delta: (newNeed.get(productId) || 0) - (oldNeed.get(productId) || 0),
      }));

      const party = parties.find((p) => p.id === partyId);
      const res = await offlineAwareSubmit({
        mutationType: editing
          ? kind === "sale"
            ? "sale_return_update"
            : "purchase_return_update"
          : kind === "sale"
            ? "sale_return"
            : "purchase_return",
        companyId,
        organizationId,
        stockChanges,
        payload: {
          ...(editing ? { return_id: editing.id, return_no: editing.returnNo } : {}),
          organization_id: organizationId,
          company_id: companyId,
          return_date: returnDate,
          party_id: partyId,
          party_name: party?.name_en || null,
          party_code: party?.party_code || null,
          parties: party
            ? {
                name_en: party.name_en,
                party_code: party.party_code,
                phone: party.phone,
                mobile: party.mobile,
                contact_person: party.contact_person,
              }
            : null,
          warehouse_id: warehouseId,
          sale_invoice_id: kind === "sale" && invoiceId ? invoiceId : null,
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
            amount: l.amount,
          })),
        },
      });

      setLoading(false);
      closeDialog?.();
      onDone?.();
      const basePath = kind === "sale" ? "/sales/returns" : "/purchases/returns";
      if (editing || res.source === "offline") {
        router.refresh();
      } else {
        router.push(`${basePath}/${res.id}`);
        router.refresh();
      }
    } catch (err: unknown) {
      setLoading(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3"
      data-enter-root
      onKeyDown={(e) => handleEnterAsNext(e)}
    >
      <div className="grid items-end gap-2 sm:grid-cols-12">
        <div className="sm:col-span-2">
          <Label>Date</Label>
          <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} required />
        </div>
        <div className="sm:col-span-5">
          <PartyCodePicker
            companyId={companyId}
            parties={partyOptions}
            value={partyId}
            required
            label={kind === "purchase" ? "Vendor code" : "Customer code"}
            emptyLabel={kind === "purchase" ? "Select vendor" : "Select customer"}
            filterSubtype={
              kind === "purchase" ? ["supplier", "both"] : ["customer", "both"]
            }
            onChange={(id) => setPartyId(id)}
          />
        </div>
          <div className="sm:col-span-3">
            <Label>Company</Label>
            <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </div>
          {kind === "sale" ? (
            <div className="sm:col-span-5">
              <Label>Sale invoice</Label>
              <Select
                value={invoiceId}
                onChange={(e) => applyInvoice(e.target.value)}
                disabled={!partyId}
              >
                <option value="">Not against an invoice</option>
                {invoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoice_no} · {inv.invoice_date}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        <div className="sm:col-span-7">
          <Label>Narration</Label>
          <Input value={narration} onChange={(e) => setNarration(e.target.value)} />
        </div>
      </div>

      {kind === "sale" && partyId && recoveredTotal > 0.005 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This customer already has recoveries totaling {formatPkr(recoveredTotal)}.
          {partyDue == null
            ? ""
            : partyDue <= 0.005
              ? " Balance is nil — a sale return would create credit and is blocked."
              : ` Only ${formatPkr(partyDue)} is still due. Return more than that is blocked.`}
        </p>
      ) : null}

      <LineItemsEditor
        ref={linesEditorRef}
        products={products}
        lines={lines}
        onChange={(next) => {
          setLines(next);
          const basis = invoiceBasis.current;
          if (extraEdited.current || !basis || !(basis.linesTotal > 0)) return;
          const total = next.reduce(
            (sum, line) => sum + calcLineAmount(line.qty, line.rate, line.discount),
            0,
          );
          const share = (basis.extra * total) / basis.linesTotal;
          setExtraDiscount(String(Math.round(Math.min(share, total) * 100) / 100));
        }}
        rateField={kind === "sale" ? "sale_rate" : "purchase_rate"}
        receiveStock={kind === "sale"}
        enableBonus={kind === "sale"}
        companyId={companyId}
        partyId={partyId}
        extraDiscount={extraDiscount}
        onExtraDiscountChange={(value) => {
          extraEdited.current = true;
          setExtraDiscount(value);
        }}
      />

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <Button type="submit" loading={loading}>
        {loading
          ? editing
            ? "Updating..."
            : "Posting..."
          : editing
            ? `Update ${kind} return`
            : `Save & post ${kind} return`}
      </Button>
    </form>
  );
}

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
import { useSingleSubmit } from "@/lib/forms/single-submit";
import { type LineItemDraft, calcLineAmount, calcLineDiscount } from "@/lib/types/trading";
import { formatPkr } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type BuyFrom = "vendor" | "company";

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
        (p) => p.party_subtype === "supplier" || p.party_subtype === "both",
      );
    }
    return parties.filter(
      (p) =>
        p.party_subtype === "customer" ||
        p.party_subtype === "both" ||
        p.party_type === "PARTY",
    );
  }, [kind, parties]);

  const [sector, setSector] = useState(() => {
    if (kind !== "sale") return "";
    const id = editing?.partyId;
    if (!id) return "";
    const hit = parties.find((p) => p.id === id);
    return (hit?.route || "").trim();
  });
  const sectorOptions = useMemo(() => {
    if (kind !== "sale") return [] as string[];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of partyOptions) {
      const v = (p.route || "").trim();
      if (!v) continue;
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [kind, partyOptions]);
  const filteredParties = useMemo(() => {
    if (kind !== "sale" || !sector) return partyOptions;
    return partyOptions.filter((p) => (p.route || "").trim() === sector);
  }, [kind, partyOptions, sector]);

  const [partyId, setPartyId] = useState(editing?.partyId || "");
  const [warehouseId, setWarehouseId] = useState(
    editing?.warehouseId || warehouses[0]?.id || "",
  );
  const [buyFrom, setBuyFrom] = useState<BuyFrom>(() => {
    if (kind !== "purchase" || !editing?.partyId) return "vendor";
    const linked = warehouses.find((w) => w.id === editing.warehouseId)
      ?.default_supplier_id;
    return linked && linked === editing.partyId ? "company" : "vendor";
  });
  const [returnDate, setReturnDate] = useState(
    editing?.returnDate || new Date().toISOString().slice(0, 10),
  );
  const [narration, setNarration] = useState(editing?.narration || "");
  const [extraDiscount, setExtraDiscount] = useState(editing?.extraDiscount || "");
  const [lines, setLines] = useState<LineItemDraft[]>(editing?.lines || []);
  const [loading, setLoading] = useState(false);
  const singleSubmit = useSingleSubmit();
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<ReturnInvoice[]>([]);
  const [invoiceId, setInvoiceId] = useState(editing?.invoiceId || "");
  const [caps, setCaps] = useState<Map<string, { qty: number; bonus: number }>>(new Map());
  const [partyDue, setPartyDue] = useState<number | null>(null);
  const [previousBalance, setPreviousBalance] = useState<number | null>(null);
  const [recoveredTotal, setRecoveredTotal] = useState(0);
  const extraEdited = useRef(Boolean(editing));
  const invoiceBasis = useRef<{ extra: number; linesTotal: number } | null>(null);
  const preserveEdit = useRef(Boolean(editing));
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const grandTotalPreview = useMemo(() => {
    const linesTotal = lines.reduce(
      (sum, line) => sum + calcLineAmount(line.qty, line.rate, line.discount),
      0,
    );
    const extra = Math.max(0, Number(extraDiscount) || 0);
    return Math.max(0, linesTotal - extra);
  }, [lines, extraDiscount]);

  // Edit open / late party list: fill Sector from the shop when still empty.
  useEffect(() => {
    if (kind !== "sale" || !partyId || sector) return;
    const hit =
      partyOptions.find((p) => p.id === partyId) ||
      parties.find((p) => p.id === partyId);
    const route = (hit?.route || "").trim();
    if (route) setSector(route);
  }, [kind, partyId, sector, partyOptions, parties]);

  useEffect(() => {
    if (kind !== "sale" || !sector || !partyId) return;
    if (!filteredParties.some((p) => p.id === partyId)) {
      setPartyId("");
      setPreviousBalance(null);
      setPartyDue(null);
    }
  }, [kind, sector, filteredParties, partyId]);

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
      setPreviousBalance(null);
      setRecoveredTotal(0);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        if (!(await isAppOnline())) {
          const { offlineAccountsBalances } = await import(
            "@/lib/offline/offline-reports"
          );
          const rows = await offlineAccountsBalances(companyId);
          const row = rows.find((r) => String(r.party_id) === partyId);
          const bal = row ? Number(row.balance || 0) : 0;
          if (!cancelled) {
            setPartyDue(bal);
            setPreviousBalance(bal);
            setRecoveredTotal(0);
          }
          return;
        }
        const supabase = createClient();
        const asOf = returnDate || new Date().toISOString().slice(0, 10);
        const balanceResult = await Promise.race([
          supabase.rpc("get_party_balance", {
            p_company_id: companyId,
            p_party_id: partyId,
            p_as_of: asOf,
          }),
          new Promise<null>((r) => setTimeout(() => r(null), 4000)),
        ]);
        const balRaw =
          balanceResult && typeof balanceResult === "object" && "data" in balanceResult
            ? (balanceResult as { data: unknown }).data
            : null;
        const bal = balRaw == null ? null : Number(balRaw);

        const { data: recs } = await supabase
          .from("recoveries")
          .select("amount")
          .eq("company_id", companyId)
          .eq("party_id", partyId)
          .gt("amount", 0)
          .lte("recovery_date", asOf);

        if (cancelled) return;
        setPartyDue(bal);
        setPreviousBalance(bal);
        setRecoveredTotal(
          (recs || []).reduce((sum, row) => sum + Number(row.amount || 0), 0),
        );
      } catch {
        if (!cancelled) {
          setPartyDue(null);
          setPreviousBalance(null);
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
    await singleSubmit(async () => {
    setError(null);
    const flushed = linesEditorRef.current?.flush() || lines;
    const valid = flushed.filter(
      (l) => l.product_id && (Number(l.qty) > 0 || Number(l.bonus || 0) > 0),
    );
    const companyVendorId =
      warehouses.find((w) => w.id === warehouseId)?.default_supplier_id || "";
    const payablePartyId =
      kind === "purchase" && buyFrom === "company" ? companyVendorId : partyId;
    if (!warehouseId || valid.length === 0 || !payablePartyId) {
      setError(
        kind === "purchase"
          ? buyFrom === "company"
            ? companyVendorId
              ? "Select a company and at least one line."
              : "This company has no vendor linked. Link a vendor on the company, or choose Return to Vendor."
            : "Select a vendor, a company, and at least one line."
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

    // Sale returns may exceed due: leftover becomes customer credit (Cr)
    // on ledger / receivables and offsets future sales as previous balance.

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

      const party = parties.find((p) => p.id === payablePartyId);
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
          party_id: payablePartyId,
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
    });
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
          <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} required />
        </div>
        {kind === "sale" ? (
          <div className="sm:col-span-2">
            <Label>Sector</Label>
            <Select
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              options={[
                { value: "", label: "All sectors" },
                ...sectorOptions.map((name) => ({ value: name, label: name })),
              ]}
            />
          </div>
        ) : null}
        {kind === "purchase" ? (
          <div className="sm:col-span-2">
            <Label>Return to</Label>
            <Select
              value={buyFrom}
              onChange={(e) => setBuyFrom((e.target.value as BuyFrom) || "vendor")}
            >
              <option value="vendor">Vendor</option>
              <option value="company">Company</option>
            </Select>
          </div>
        ) : null}
        {kind === "purchase" && buyFrom === "company" ? (
          <div className="sm:col-span-8">
            <Label>Company</Label>
            <Select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              required
            >
              <option value="">Select company</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <>
            <div className={kind === "sale" ? "sm:col-span-8" : "sm:col-span-5"}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <PartyCodePicker
                    companyId={companyId}
                    parties={kind === "sale" ? filteredParties : partyOptions}
                    value={partyId}
                    required
                    maxVisible={kind === "purchase" ? 10000 : undefined}
                    label={kind === "purchase" ? "Vendor" : "Customer code / shop"}
                    emptyLabel={
                      kind === "purchase"
                        ? "Select vendor"
                        : sector
                          ? filteredParties.length
                            ? "Select customer"
                            : "No shops in this sector"
                          : "Select customer"
                    }
                    filterSubtype={
                      kind === "purchase" ? ["supplier", "both"] : ["customer", "both"]
                    }
                    confineToList={kind === "sale" && Boolean(sector)}
                    confineRoute={kind === "sale" ? sector : ""}
                    onChange={(id) => {
                      setPartyId(id);
                      if (kind === "sale") {
                        if (id) {
                          const selected =
                            partyOptions.find((p) => p.id === id) ||
                            parties.find((p) => p.id === id);
                          const route = (selected?.route || "").trim();
                          if (route) setSector(route);
                        } else {
                          setPreviousBalance(null);
                          setPartyDue(null);
                        }
                      }
                    }}
                  />
                </div>
                {kind === "sale" ? (
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
                ) : null}
              </div>
            </div>
            <div className="sm:col-span-3">
              <Label>{kind === "purchase" ? "Stock company" : "Company"}</Label>
              <Select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                required
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </div>
          </>
        )}
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
        <div className={kind === "sale" ? "sm:col-span-7" : "sm:col-span-7"}>
          <Label>Narration</Label>
          <Input value={narration} onChange={(e) => setNarration(e.target.value)} />
        </div>
      </div>

      {kind === "purchase" && buyFrom === "company" ? (
        <p className="text-xs text-[var(--muted)]">
          {(() => {
            const linkedId =
              warehouses.find((w) => w.id === warehouseId)?.default_supplier_id || "";
            const linked = parties.find((p) => p.id === linkedId);
            if (!warehouseId) return "Pick a company. The return is saved on that company.";
            if (!linked) {
              return "No vendor is linked to this company. Link one, or switch to Return to Vendor.";
            }
            return `Saved on this company. Credit goes to ${linked.party_code} — ${linked.name_en}.`;
          })()}
        </p>
      ) : null}

      {kind === "sale" && partyId && partyDue != null && (() => {
        const dueBeforeReturn =
          partyDue +
          (editing && partyId === editing.partyId ? editing.grandTotal : 0);
        const creditAfter = grandTotalPreview - dueBeforeReturn;
        if (creditAfter <= 0.005) {
          return recoveredTotal > 0.005 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This customer already has recoveries totaling {formatPkr(recoveredTotal)}.
            </p>
          ) : null;
        }
        return (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {dueBeforeReturn <= 0.005
              ? `Balance is nil${recoveredTotal > 0.005 ? ` (recoveries recorded: ${formatPkr(recoveredTotal)})` : ""}. This return will create a customer credit (Cr) of ${formatPkr(grandTotalPreview)}. It will show on receivables and reduce the previous balance on the next sale.`
              : `Customer only owes ${formatPkr(dueBeforeReturn)}. Return of ${formatPkr(grandTotalPreview)} will leave credit (Cr) of ${formatPkr(creditAfter)} on receivables / next sale previous balance.`}
          </p>
        );
      })()}

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
        partyId={
          kind === "purchase" && buyFrom === "company"
            ? warehouses.find((w) => w.id === warehouseId)?.default_supplier_id || ""
            : partyId
        }
        {...(kind === "purchase"
          ? {
              warehouseId,
              warehouses,
              filterByWarehouse: true as const,
            }
          : {})}
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

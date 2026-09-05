import { one } from "@/lib/reports/helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PurchaseReportType =
  | "summary"
  | "bill_wise"
  | "supplier_wise"
  | "detail"
  | "manufacturer_wise"
  | "item_wise"
  | "expiry_claims";

export const PURCHASE_REPORT_TYPES: { key: PurchaseReportType; label: string }[] = [
  { key: "summary", label: "Purchase summary" },
  { key: "bill_wise", label: "Bill wise" },
  { key: "supplier_wise", label: "Vendor wise" },
  { key: "detail", label: "Purchase detail" },
  { key: "item_wise", label: "Item wise purchase" },
  { key: "manufacturer_wise", label: "Company wise" },
  { key: "expiry_claims", label: "Expiry vendor claims" },
];

type Filters = {
  companyId: string;
  from: string;
  to: string;
  type: PurchaseReportType;
  warehouseIds?: string[];
  partyIds?: string[];
  billFrom?: string;
  billTo?: string;
};

export async function buildPurchaseReport(
  supabase: SupabaseClient,
  filters: Filters,
) {
  if (filters.type === "expiry_claims") {
    return buildExpiryClaimPurchaseReport(supabase, filters);
  }

  let query = supabase
    .from("purchase_invoices")
    .select(
      "id, invoice_no, supplier_bill_no, invoice_date, grand_total, discount_total, extra_discount, subtotal, party_id, warehouse_id, parties(party_code, name_en, city), warehouses(name)",
    )
    .eq("company_id", filters.companyId)
    .eq("status", "posted")
    .gte("invoice_date", filters.from)
    .lte("invoice_date", filters.to)
    .order("invoice_date", { ascending: true })
    .limit(2000);

  if (filters.warehouseIds?.length) {
    query = query.in("warehouse_id", filters.warehouseIds);
  }
  if (filters.partyIds?.length) {
    query = query.in("party_id", filters.partyIds);
  }

  const { data: invoices, error } = await query;
  if (error) throw new Error(error.message);
  let list = invoices || [];

  if (filters.type === "bill_wise" && (filters.billFrom || filters.billTo)) {
    list = list.filter((inv) => {
      const no = inv.invoice_no || "";
      if (filters.billFrom && no < filters.billFrom) return false;
      if (filters.billTo && no > filters.billTo) return false;
      return true;
    });
  }

  if (
    ["detail", "item_wise", "manufacturer_wise"].includes(filters.type) &&
    list.length
  ) {
    const ids = list.map((i) => i.id);
    const { data: items } = await supabase
      .from("purchase_invoice_items")
      .select(
        "purchase_invoice_id, product_code, product_name, qty, rate, discount, amount, products(default_warehouse_id)",
      )
      .in("purchase_invoice_id", ids);

    const invMap = new Map(list.map((i) => [i.id, i]));

    if (filters.type === "manufacturer_wise") {
      const whIds = new Set<string>();
      for (const it of items || []) {
        const product = one(it.products);
        const inv = invMap.get(it.purchase_invoice_id);
        const wid = product?.default_warehouse_id || inv?.warehouse_id;
        if (wid) whIds.add(wid);
      }
      const whNameById = new Map<string, string>();
      if (whIds.size) {
        const { data: whRows } = await supabase
          .from("warehouses")
          .select("id, name")
          .in("id", [...whIds]);
        for (const w of whRows || []) {
          whNameById.set(w.id, w.name);
        }
      }

      const grouped = new Map<string, { qty: number; amount: number }>();
      for (const it of items || []) {
        const product = one(it.products);
        const inv = invMap.get(it.purchase_invoice_id);
        const headerWh = one(inv?.warehouses);
        const warehouseId =
          product?.default_warehouse_id || inv?.warehouse_id || "";
        const key =
          whNameById.get(warehouseId) || headerWh?.name || "Unassigned";
        const cur = grouped.get(key) || { qty: 0, amount: 0 };
        cur.qty += Number(it.qty);
        cur.amount += Number(it.amount);
        grouped.set(key, cur);
      }
      return [...grouped.entries()].map(([key, v]) => ({
        Company: key,
        Qty: v.qty,
        Amount: v.amount,
      }));
    }

    return (items || []).map((it) => {
      const inv = invMap.get(it.purchase_invoice_id);
      const party = one(inv?.parties);
      const warehouse = one(inv?.warehouses);
      return {
        Date: inv?.invoice_date,
        Invoice: inv?.invoice_no,
        "Vendor bill": inv?.supplier_bill_no || "",
        Vendor: party ? `${party.party_code} — ${party.name_en}` : "",
        City: party?.city || "",
        Company: warehouse?.name || "",
        Code: it.product_code,
        Item: it.product_name,
        Qty: Number(it.qty),
        Rate: Number(it.rate),
        Amount: Number(it.amount),
      };
    });
  }

  if (filters.type === "supplier_wise" || filters.type === "summary") {
    const grouped = new Map<
      string,
      { bills: number; amount: number; city: string }
    >();
    for (const inv of list) {
      const party = one(inv.parties);
      const key = party ? `${party.party_code} — ${party.name_en}` : "Unknown";
      const cur = grouped.get(key) || {
        bills: 0,
        amount: 0,
        city: party?.city || "",
      };
      cur.bills += 1;
      cur.amount += Number(inv.grand_total);
      grouped.set(key, cur);
    }
    return [...grouped.entries()].map(([Vendor, v]) => ({
      Vendor,
      City: v.city,
      Bills: v.bills,
      Amount: v.amount,
    }));
  }

  return list.map((inv) => {
    const party = one(inv.parties);
    const warehouse = one(inv.warehouses);
    return {
      Date: inv.invoice_date,
      Invoice: inv.invoice_no,
      "Vendor bill": inv.supplier_bill_no || "",
      Vendor: party ? `${party.party_code} — ${party.name_en}` : "",
      Company: warehouse?.name || "",
      Subtotal: Number(inv.subtotal),
      "Trade discount": Number(inv.discount_total),
      "Extra discount": Number(inv.extra_discount || 0),
      Total: Number(inv.grand_total),
    };
  });
}

async function buildExpiryClaimPurchaseReport(
  supabase: SupabaseClient,
  filters: Filters,
) {
  let query = supabase
    .from("expiry_claims")
    .select(
      "id, claim_no, claim_date, claim_status, grand_total, accepted_amount, rejected_amount, warehouse_id, party_id, parties(party_code, name_en), warehouses(name)",
    )
    .eq("company_id", filters.companyId)
    .eq("status", "posted")
    .gte("claim_date", filters.from)
    .lte("claim_date", filters.to)
    .order("claim_date", { ascending: true })
    .limit(2000);

  if (filters.warehouseIds?.length) {
    query = query.in("warehouse_id", filters.warehouseIds);
  }
  if (filters.partyIds?.length) {
    query = query.in("party_id", filters.partyIds);
  }

  const { data: claims, error } = await query;
  if (error) throw new Error(error.message);
  if (!claims?.length) return [];

  const { data: items, error: itemError } = await supabase
    .from("expiry_claim_items")
    .select("claim_id, product_code, product_name, qty, rate, amount")
    .in(
      "claim_id",
      claims.map((c) => c.id),
    );
  if (itemError) throw new Error(itemError.message);

  const claimMap = new Map(claims.map((c) => [c.id, c]));
  return (items || []).map((it) => {
    const doc = claimMap.get(it.claim_id);
    const party = one(doc?.parties);
    const warehouse = one(doc?.warehouses);
    return {
      Date: doc?.claim_date,
      No: doc?.claim_no,
      Vendor: party ? `${party.party_code} — ${party.name_en}` : "",
      Company: warehouse?.name || "—",
      Status: doc?.claim_status || "open",
      Code: it.product_code,
      Item: it.product_name,
      Qty: Number(it.qty),
      Rate: Number(it.rate),
      Amount: Number(it.amount),
      _href: doc?.id ? `/inventory/expiry/claims/${doc.id}` : "",
    };
  });
}


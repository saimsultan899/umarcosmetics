import { one } from "@/lib/reports/helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PurchaseReportType =
  | "summary"
  | "bill_wise"
  | "supplier_wise"
  | "detail"
  | "manufacturer_wise"
  | "item_wise";

export const PURCHASE_REPORT_TYPES: { key: PurchaseReportType; label: string }[] = [
  { key: "summary", label: "Purchase summary" },
  { key: "bill_wise", label: "Bill wise" },
  { key: "supplier_wise", label: "Vendor / manufacturer wise" },
  { key: "detail", label: "Purchase detail" },
  { key: "item_wise", label: "Item wise purchase" },
  { key: "manufacturer_wise", label: "Manufacturer / group wise" },
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
  let query = supabase
    .from("purchase_invoices")
    .select(
      "id, invoice_no, supplier_bill_no, invoice_date, grand_total, discount_total, subtotal, party_id, warehouse_id, parties(party_code, name_en, city), warehouses(name)",
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
        "purchase_invoice_id, product_code, product_name, qty, rate, discount, amount, products(manufacturer, category_group)",
      )
      .in("purchase_invoice_id", ids);

    const invMap = new Map(list.map((i) => [i.id, i]));

    if (filters.type === "manufacturer_wise") {
      const grouped = new Map<string, { qty: number; amount: number }>();
      for (const it of items || []) {
        const product = one(it.products);
        const key =
          [product?.manufacturer, product?.category_group]
            .filter(Boolean)
            .join(" / ") || "Uncategorized";
        const cur = grouped.get(key) || { qty: 0, amount: 0 };
        cur.qty += Number(it.qty);
        cur.amount += Number(it.amount);
        grouped.set(key, cur);
      }
      return [...grouped.entries()].map(([key, v]) => ({
        "Manufacturer / Group": key,
        Qty: v.qty,
        Amount: v.amount,
      }));
    }

    return (items || []).map((it) => {
      const inv = invMap.get(it.purchase_invoice_id);
      const product = one(it.products);
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
        Manufacturer: product?.manufacturer || "",
        Group: product?.category_group || "",
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
      Discount: Number(inv.discount_total),
      Total: Number(inv.grand_total),
    };
  });
}

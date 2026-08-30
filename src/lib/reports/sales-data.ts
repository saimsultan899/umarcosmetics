import { formatReportDate, formatReportInvNo, one } from "@/lib/reports/helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SaleReportType =
  | "date_wise"
  | "credit_sales"
  | "cash_sales"
  | "bill_range"
  | "party_wise"
  | "item_wise"
  | "manufacturer_wise"
  | "city_wise"
  | "route_wise"
  | "salesman_wise"
  | "sale_profit"
  | "cash_flow";

export const SALE_REPORT_TYPES: { key: SaleReportType; label: string }[] = [
  { key: "date_wise", label: "Date wise sales" },
  { key: "cash_sales", label: "Date wise counter/cash sales" },
  { key: "credit_sales", label: "Date wise credit sales" },
  { key: "bill_range", label: "Bill # range" },
  { key: "party_wise", label: "Item, Customer Wise Sales Detail" },
  { key: "item_wise", label: "Item wise sale detail" },
  { key: "manufacturer_wise", label: "Manufacturer / category wise" },
  { key: "city_wise", label: "Head / City sales" },
  { key: "route_wise", label: "Sector wise sales" },
  { key: "salesman_wise", label: "Salesman wise sales" },
  { key: "sale_profit", label: "Sale profit" },
  { key: "cash_flow", label: "Cash flow (sales)" },
];

type Filters = {
  companyId: string;
  from: string;
  to: string;
  type: SaleReportType;
  warehouseId?: string;
  partyId?: string;
  billFrom?: string;
  billTo?: string;
};

export async function buildSaleReport(
  supabase: SupabaseClient,
  filters: Filters,
) {
  let query = supabase
    .from("sale_invoices")
    .select(
      "id, invoice_no, invoice_date, payment_type, grand_total, amount_paid, discount_total, subtotal, city, route, created_by, salesman_id, party_id, warehouse_id, parties(party_code, name_en, address, city, route, head), warehouses(name), salesman:salesmen!sale_invoices_salesman_id_fkey(id, full_name)",
    )
    .eq("company_id", filters.companyId)
    .eq("status", "posted")
    .gte("invoice_date", filters.from)
    .lte("invoice_date", filters.to)
    .order("invoice_date", { ascending: true })
    .limit(2000);

  if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);
  if (filters.partyId) query = query.eq("party_id", filters.partyId);
  if (filters.type === "cash_sales") query = query.eq("payment_type", "cash");
  if (filters.type === "credit_sales") query = query.in("payment_type", ["credit", "partial"]);

  const { data: invoices, error } = await query;
  if (error) throw new Error(error.message);

  let list = invoices || [];

  if (filters.type === "bill_range" && (filters.billFrom || filters.billTo)) {
    list = list.filter((inv) => {
      const no = inv.invoice_no || "";
      if (filters.billFrom && no < filters.billFrom) return false;
      if (filters.billTo && no > filters.billTo) return false;
      return true;
    });
  }

  if (
    ["item_wise", "manufacturer_wise", "sale_profit", "party_wise"].includes(
      filters.type,
    ) &&
    list.length
  ) {
    const ids = list.map((i) => i.id);
    const { data: items } = await supabase
      .from("sale_invoice_items")
      .select(
        "sale_invoice_id, product_code, product_name, qty, rate, discount, amount, product_id, products(manufacturer, category_group, purchase_rate)",
      )
      .in("sale_invoice_id", ids);

    const invMap = new Map(list.map((i) => [i.id, i]));

    if (filters.type === "party_wise") {
      const detail = (items || [])
        .map((it) => {
          const inv = invMap.get(it.sale_invoice_id);
          const party = one(inv?.parties);
          const partyName = (party?.name_en || "Unknown").toUpperCase();
          const routePart = party?.route || party?.head;
          const partyLine = [
            party?.party_code,
            party?.address,
            party?.city,
            routePart ? `( ${routePart} ) RANGE` : null,
          ]
            .filter(Boolean)
            .join(" ");
          return {
            Date: formatReportDate(inv?.invoice_date),
            "Inv No.": formatReportInvNo(inv?.invoice_no),
            "Item No": it.product_code || "",
            ItemName: (it.product_name || "").toUpperCase(),
            Qty: Number(it.qty),
            Price: Number(it.rate),
            Amount: Number(it.amount),
            _sort_date: inv?.invoice_date || "",
            _party_id: inv?.party_id || party?.party_code || "unknown",
            _party_name: partyName,
            _party_line: partyLine,
          };
        })
        .sort((a, b) => {
          const partyCmp = a._party_name.localeCompare(b._party_name);
          if (partyCmp) return partyCmp;
          const dateCmp = a._sort_date.localeCompare(b._sort_date);
          if (dateCmp) return dateCmp;
          return String(a["Inv No."]).localeCompare(String(b["Inv No."]));
        });
      return detail;
    }

    if (filters.type === "item_wise") {
      return (items || []).map((it) => {
        const inv = invMap.get(it.sale_invoice_id);
          const party = one(inv?.parties);
        return {
          Date: inv?.invoice_date,
          Invoice: inv?.invoice_no,
          Customer: party ? `${party.party_code} — ${party.name_en}` : "",
          Code: it.product_code,
          Item: it.product_name,
          Qty: Number(it.qty),
          Rate: Number(it.rate),
          Discount: Number(it.discount),
          Amount: Number(it.amount),
        };
      });
    }

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
        "Manufacturer / Category": key,
        Qty: v.qty,
        Amount: v.amount,
      }));
    }

    if (filters.type === "sale_profit") {
      return (items || []).map((it) => {
        const inv = invMap.get(it.sale_invoice_id);
        const product = one(it.products);
        const cost = Number(product?.purchase_rate || 0) * Number(it.qty);
        const sale = Number(it.amount);
        return {
          Date: inv?.invoice_date,
          Invoice: inv?.invoice_no,
          Item: it.product_name,
          Qty: Number(it.qty),
          "Sale amount": sale,
          "Est. cost": cost,
          Profit: sale - cost,
        };
      });
    }
  }

  if (filters.type === "party_wise") {
    return [];
  }

  if (filters.type === "city_wise") {
    const grouped = new Map<string, { bills: number; amount: number }>();
    for (const inv of list) {
      const key = inv.city || "No city";
      const cur = grouped.get(key) || { bills: 0, amount: 0 };
      cur.bills += 1;
      cur.amount += Number(inv.grand_total);
      grouped.set(key, cur);
    }
    return [...grouped.entries()].map(([City, v]) => ({
      City,
      Bills: v.bills,
      Amount: v.amount,
    }));
  }

  if (filters.type === "route_wise") {
    const grouped = new Map<string, { bills: number; amount: number }>();
    for (const inv of list) {
      const key = inv.route || "No sector";
      const cur = grouped.get(key) || { bills: 0, amount: 0 };
      cur.bills += 1;
      cur.amount += Number(inv.grand_total);
      grouped.set(key, cur);
    }
    return [...grouped.entries()].map(([Sector, v]) => ({
      Sector,
      Bills: v.bills,
      Amount: v.amount,
    }));
  }

  if (filters.type === "salesman_wise") {
    const grouped = new Map<string, { bills: number; amount: number }>();
    for (const inv of list) {
      const sm = one(inv.salesman);
      const key = sm?.full_name || "Unassigned";
      const cur = grouped.get(key) || { bills: 0, amount: 0 };
      cur.bills += 1;
      cur.amount += Number(inv.grand_total);
      grouped.set(key, cur);
    }
    return [...grouped.entries()].map(([Salesman, v]) => ({
      Salesman,
      Bills: v.bills,
      Amount: v.amount,
    }));
  }

  if (filters.type === "cash_flow") {
    return list.map((inv) => {
      const party = one(inv.parties);
      return {
        Date: inv.invoice_date,
        Invoice: inv.invoice_no,
        Customer: party ? `${party.party_code} — ${party.name_en}` : "",
        Type: inv.payment_type,
        "Invoice total": Number(inv.grand_total),
        "Cash received": Number(inv.amount_paid),
        "Credit balance":
          Number(inv.grand_total) - Number(inv.amount_paid),
      };
    });
  }

  // date_wise / default detail
  return list.map((inv) => {
    const party = one(inv.parties);
    const warehouse = one(inv.warehouses);
    return {
      Date: inv.invoice_date,
      Invoice: inv.invoice_no,
      Customer: party ? `${party.party_code} — ${party.name_en}` : "",
      Company: warehouse?.name || "",
      Payment: inv.payment_type,
      City: inv.city || "",
      Sector: inv.route || "",
      Subtotal: Number(inv.subtotal),
      Discount: Number(inv.discount_total),
      Total: Number(inv.grand_total),
      Paid: Number(inv.amount_paid),
    };
  });
}

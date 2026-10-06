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
  | "cash_flow"
  | "expiry_credits";

export const SALE_REPORT_TYPES: { key: SaleReportType; label: string }[] = [
  { key: "date_wise", label: "Date wise sales" },
  { key: "cash_sales", label: "Date wise counter/cash sales" },
  { key: "credit_sales", label: "Date wise credit sales" },
  { key: "bill_range", label: "Bill # range" },
  { key: "party_wise", label: "Item, Customer Wise Sales Detail" },
  { key: "item_wise", label: "Item wise sale detail" },
  { key: "manufacturer_wise", label: "Company wise" },
  { key: "city_wise", label: "Head / City sales" },
  { key: "route_wise", label: "Sector wise sales" },
  { key: "salesman_wise", label: "Salesman wise sales" },
  { key: "sale_profit", label: "Sale profit" },
  { key: "cash_flow", label: "Cash flow (company top customers)" },
  { key: "expiry_credits", label: "Expiry customer credits" },
];

type Filters = {
  companyId: string;
  from: string;
  to: string;
  type: SaleReportType;
  warehouseIds?: string[];
  partyIds?: string[];
  /** Product ids (sale_invoice_items.product_id) — single or multiple. */
  productIds?: string[];
  /** Sector (sale_invoices.route). */
  routes?: string[];
  /** Head / City (sale_invoices.city). */
  cities?: string[];
  billFrom?: string;
  billTo?: string;
  walkInOnly?: boolean;
  walkInPartyId?: string | null;
};

/** Company filter is product warehouse, not the invoice header. */
const LINE_COMPANY_TYPES: SaleReportType[] = [
  "party_wise",
  "item_wise",
  "manufacturer_wise",
  "sale_profit",
  "cash_flow",
];

function lineCompanyId(
  product: { default_warehouse_id?: string | null } | null,
  warehouseId?: string | null,
) {
  return product?.default_warehouse_id || warehouseId || "";
}

function matchesCompanyFilter(
  product: { default_warehouse_id?: string | null } | null,
  warehouseId: string | null | undefined,
  warehouseIds?: string[],
) {
  if (!warehouseIds?.length) return true;
  const id = lineCompanyId(product, warehouseId);
  return warehouseIds.includes(id);
}

function matchesProductFilter(
  productId: string | null | undefined,
  productIds?: string[],
) {
  if (!productIds?.length) return true;
  if (!productId) return false;
  return productIds.includes(productId);
}

export async function buildSaleReport(
  supabase: SupabaseClient,
  filters: Filters,
) {
  if (filters.type === "expiry_credits") {
    return buildExpiryCreditReport(supabase, filters);
  }

  let query = supabase
    .from("sale_invoices")
    .select(
      "id, invoice_no, invoice_date, payment_type, grand_total, amount_paid, discount_total, extra_discount, subtotal, city, route, created_by, salesman_id, party_id, warehouse_id, parties(party_code, name_en, address, city, route, head), warehouses(name), salesman:salesmen!sale_invoices_salesman_id_fkey(id, full_name)",
    )
    .eq("company_id", filters.companyId)
    .eq("status", "posted")
    .gte("invoice_date", filters.from)
    .lte("invoice_date", filters.to)
    .order("invoice_date", { ascending: true })
    .limit(2000);

  if (filters.warehouseIds?.length && !LINE_COMPANY_TYPES.includes(filters.type)) {
    query = query.in("warehouse_id", filters.warehouseIds);
  }
  if (filters.walkInOnly) {
    if (!filters.walkInPartyId) {
      return [];
    }
    query = query.eq("party_id", filters.walkInPartyId);
  } else if (filters.partyIds?.length) {
    query = query.in("party_id", filters.partyIds);
  }
  if (filters.routes?.length) {
    query = query.in("route", filters.routes);
  }
  if (filters.cities?.length) {
    query = query.in("city", filters.cities);
  }
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

  // Header-level reports: keep invoices that contain any selected product.
  if (
    filters.productIds?.length &&
    list.length &&
    !LINE_COMPANY_TYPES.includes(filters.type)
  ) {
    const { data: matchItems } = await supabase
      .from("sale_invoice_items")
      .select("sale_invoice_id")
      .in(
        "sale_invoice_id",
        list.map((i) => i.id),
      )
      .in("product_id", filters.productIds);
    const matchIds = new Set((matchItems || []).map((r) => r.sale_invoice_id));
    list = list.filter((inv) => matchIds.has(inv.id));
  }

  if (
    [
      "item_wise",
      "manufacturer_wise",
      "sale_profit",
      "party_wise",
      "cash_flow",
    ].includes(filters.type) &&
    list.length
  ) {
    const ids = list.map((i) => i.id);
    const { data: items } = await supabase
      .from("sale_invoice_items")
      .select(
        "sale_invoice_id, product_code, product_name, qty, rate, discount, amount, product_id, products(purchase_rate, default_warehouse_id)",
      )
      .in("sale_invoice_id", ids);

    const invMap = new Map(list.map((i) => [i.id, i]));

    if (filters.type === "cash_flow") {
      // Company (product brand) → top customers → invoices
      type InvBucket = {
        invoiceId: string;
        date: string;
        invoiceNo: string;
        paymentType: string;
        amount: number;
        cash: number;
        credit: number;
      };
      type PartyBucket = {
        partyId: string;
        partyCode: string;
        partyName: string;
        invoices: Map<string, InvBucket>;
        amount: number;
      };
      type CompanyBucket = {
        warehouseId: string;
        companyName: string;
        parties: Map<string, PartyBucket>;
        amount: number;
      };

      const whIds = new Set<string>();
      for (const it of items || []) {
        const product = one(it.products);
        const inv = invMap.get(it.sale_invoice_id);
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

      const companies = new Map<string, CompanyBucket>();
      const warehouseFilter = new Set(filters.warehouseIds || []);

      for (const it of items || []) {
        const inv = invMap.get(it.sale_invoice_id);
        if (!inv) continue;
        if (!matchesProductFilter(it.product_id, filters.productIds)) continue;
        const product = one(it.products);
        const headerWh = one(inv.warehouses);
        const warehouseId =
          product?.default_warehouse_id || inv.warehouse_id || "unknown";
        if (warehouseFilter.size && !warehouseFilter.has(warehouseId)) continue;

        const companyName = (
          whNameById.get(warehouseId) ||
          headerWh?.name ||
          "Unknown company"
        ).toUpperCase();
        const party = one(inv.parties);
        const partyId = inv.party_id || "unknown";
        const lineAmount = Number(it.amount || 0);
        const billTotal = Number(inv.grand_total || 0);
        const paid = Number(inv.amount_paid || 0);
        const cashShare =
          billTotal > 0 ? (lineAmount / billTotal) * paid : 0;
        const creditShare = lineAmount - cashShare;

        let company = companies.get(warehouseId);
        if (!company) {
          company = {
            warehouseId,
            companyName,
            parties: new Map(),
            amount: 0,
          };
          companies.set(warehouseId, company);
        }

        let partyBucket = company.parties.get(partyId);
        if (!partyBucket) {
          partyBucket = {
            partyId,
            partyCode: party?.party_code || "",
            partyName: (party?.name_en || "Unknown").toUpperCase(),
            invoices: new Map(),
            amount: 0,
          };
          company.parties.set(partyId, partyBucket);
        }

        let invBucket = partyBucket.invoices.get(inv.id);
        if (!invBucket) {
          invBucket = {
            invoiceId: inv.id,
            date: inv.invoice_date,
            invoiceNo: inv.invoice_no,
            paymentType: inv.payment_type || "credit",
            amount: 0,
            cash: 0,
            credit: 0,
          };
          partyBucket.invoices.set(inv.id, invBucket);
        }

        invBucket.amount += lineAmount;
        invBucket.cash += cashShare;
        invBucket.credit += creditShare;
        partyBucket.amount += lineAmount;
        company.amount += lineAmount;
      }

      const rows: Record<string, unknown>[] = [];
      const sortedCompanies = [...companies.values()].sort((a, b) =>
        a.companyName.localeCompare(b.companyName),
      );

      for (const company of sortedCompanies) {
        const topParties = [...company.parties.values()].sort(
          (a, b) => b.amount - a.amount,
        );
        topParties.forEach((party, rank) => {
          const invoices = [...party.invoices.values()].sort((a, b) => {
            const d = a.date.localeCompare(b.date);
            if (d) return d;
            return a.invoiceNo.localeCompare(b.invoiceNo);
          });
          for (const inv of invoices) {
            rows.push({
              Date: formatReportDate(inv.date),
              "Inv No.": formatReportInvNo(inv.invoiceNo),
              Type: String(inv.paymentType || "").toUpperCase(),
              "Sale amount": Math.round(inv.amount * 100) / 100,
              "Cash received": Math.round(inv.cash * 100) / 100,
              "Credit balance": Math.round(inv.credit * 100) / 100,
              _company: company.companyName,
              _company_amount: company.amount,
              _party_id: party.partyId,
              _party_code: party.partyCode,
              _party_name: party.partyName,
              _party_amount: party.amount,
              _party_rank: rank + 1,
              _href: `/sales/invoices/${inv.invoiceId}`,
              _sort_date: inv.date,
            });
          }
        });
      }
      return rows;
    }

    if (filters.type === "party_wise") {
      const warehouseIds = filters.warehouseIds;
      const detail = (items || [])
        .map((it) => {
          const inv = invMap.get(it.sale_invoice_id);
          if (!matchesProductFilter(it.product_id, filters.productIds)) {
            return null;
          }
          if (
            !matchesCompanyFilter(
              one(it.products),
              inv?.warehouse_id,
              warehouseIds,
            )
          ) {
            return null;
          }
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
            _href: inv?.id ? `/sales/invoices/${inv.id}` : "",
          };
        })
        .filter((row): row is NonNullable<typeof row> => row != null)
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
      return (items || [])
        .filter((it) => {
          const inv = invMap.get(it.sale_invoice_id);
          if (!matchesProductFilter(it.product_id, filters.productIds)) {
            return false;
          }
          return matchesCompanyFilter(
            one(it.products),
            inv?.warehouse_id,
            filters.warehouseIds,
          );
        })
        .map((it) => {
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
          _href: inv?.id ? `/sales/invoices/${inv.id}` : "",
        };
      });
    }

    if (filters.type === "manufacturer_wise") {
      const whIds = new Set<string>();
      for (const it of items || []) {
        const product = one(it.products);
        const inv = invMap.get(it.sale_invoice_id);
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

      const grouped = new Map<
        string,
        {
          bills: Set<string>;
          customers: Set<string>;
          qty: number;
          discount: number;
          amount: number;
          cost: number;
          returnQty: number;
          returnAmount: number;
          returnCost: number;
        }
      >();
      const ensure = (key: string) => {
        const cur = grouped.get(key) || {
          bills: new Set<string>(),
          customers: new Set<string>(),
          qty: 0,
          discount: 0,
          amount: 0,
          cost: 0,
          returnQty: 0,
          returnAmount: 0,
          returnCost: 0,
        };
        grouped.set(key, cur);
        return cur;
      };
      const companyName = (
        warehouseId: string,
        fallback?: string | null,
      ) => whNameById.get(warehouseId) || fallback || "Unassigned";

      for (const it of items || []) {
        if (!matchesProductFilter(it.product_id, filters.productIds)) continue;
        const product = one(it.products);
        const inv = invMap.get(it.sale_invoice_id);
        if (
          !matchesCompanyFilter(
            product,
            inv?.warehouse_id,
            filters.warehouseIds,
          )
        ) {
          continue;
        }
        const headerWh = one(inv?.warehouses);
        const warehouseId =
          product?.default_warehouse_id || inv?.warehouse_id || "";
        const key = companyName(warehouseId, headerWh?.name);
        const cur = ensure(key);
        const qty = Number(it.qty);
        cur.qty += qty;
        cur.discount += Number(it.discount || 0);
        cur.amount += Number(it.amount);
        cur.cost += qty * Number(product?.purchase_rate || 0);
        if (inv?.id) cur.bills.add(inv.id);
        if (inv?.party_id) cur.customers.add(inv.party_id);
      }

      let returnQuery = supabase
        .from("sale_returns")
        .select("id, party_id, warehouse_id, parties(city, route)")
        .eq("company_id", filters.companyId)
        .eq("status", "posted")
        .gte("return_date", filters.from)
        .lte("return_date", filters.to)
        .limit(2000);
      if (filters.walkInOnly && filters.walkInPartyId) {
        returnQuery = returnQuery.eq("party_id", filters.walkInPartyId);
      } else if (filters.partyIds?.length) {
        returnQuery = returnQuery.in("party_id", filters.partyIds);
      }
      const { data: returnHeaders, error: returnError } = await returnQuery;
      if (returnError) throw new Error(returnError.message);
      const returnDocs = (returnHeaders || []).filter((doc) => {
        const party = one(doc.parties);
        if (filters.routes?.length && !filters.routes.includes(party?.route || "")) {
          return false;
        }
        if (filters.cities?.length && !filters.cities.includes(party?.city || "")) {
          return false;
        }
        return true;
      });
      if (returnDocs.length) {
        const { data: returnItems, error: returnItemError } = await supabase
          .from("sale_return_items")
          .select(
            "sale_return_id, product_id, qty, amount, products(purchase_rate, default_warehouse_id)",
          )
          .in(
            "sale_return_id",
            returnDocs.map((doc) => doc.id),
          );
        if (returnItemError) throw new Error(returnItemError.message);
        const returnMap = new Map(returnDocs.map((doc) => [doc.id, doc]));
        const missingWh = [
          ...new Set(
            (returnItems || [])
              .map((it) => one(it.products)?.default_warehouse_id)
              .filter((id): id is string => Boolean(id) && !whNameById.has(id)),
          ),
        ];
        if (missingWh.length) {
          const { data: extraWh } = await supabase
            .from("warehouses")
            .select("id, name")
            .in("id", missingWh);
          for (const w of extraWh || []) whNameById.set(w.id, w.name);
        }
        for (const it of returnItems || []) {
          if (!matchesProductFilter(it.product_id, filters.productIds)) continue;
          const product = one(it.products);
          const doc = returnMap.get(it.sale_return_id);
          if (
            !matchesCompanyFilter(
              product,
              doc?.warehouse_id,
              filters.warehouseIds,
            )
          ) {
            continue;
          }
          const warehouseId =
            product?.default_warehouse_id || doc?.warehouse_id || "";
          const key = companyName(warehouseId);
          const cur = ensure(key);
          const qty = Number(it.qty || 0);
          cur.returnQty += qty;
          cur.returnAmount += Number(it.amount || 0);
          cur.returnCost += qty * Number(product?.purchase_rate || 0);
        }
      }

      return [...grouped.entries()]
        .map(([key, v]) => {
          const netQty = v.qty - v.returnQty;
          const netAmount = v.amount - v.returnAmount;
          const netCost = v.cost - v.returnCost;
          return {
            Company: key,
            Bills: v.bills.size,
            Qty: v.qty,
            Amount: v.amount,
            "Return qty": v.returnQty,
            "Return amount": v.returnAmount,
            "Net qty": netQty,
            "Net amount": netAmount,
            Cost: netCost,
            Profit: netAmount - netCost,
          };
        })
        .sort((a, b) => b["Net amount"] - a["Net amount"]);
    }

    if (filters.type === "sale_profit") {
      return (items || [])
        .filter((it) => {
          const inv = invMap.get(it.sale_invoice_id);
          if (!matchesProductFilter(it.product_id, filters.productIds)) {
            return false;
          }
          return matchesCompanyFilter(
            one(it.products),
            inv?.warehouse_id,
            filters.warehouseIds,
          );
        })
        .map((it) => {
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
          _href: inv?.id ? `/sales/invoices/${inv.id}` : "",
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
    // Handled above with item-level company attribution; empty when no invoices.
    return [];
  }

  // date_wise / default detail
  return list.map((inv) => {
    const party = one(inv.parties);
    return {
      Date: inv.invoice_date,
      Invoice: inv.invoice_no,
      Customer: party ? `${party.party_code} — ${party.name_en}` : "",
      Payment: inv.payment_type,
      City: inv.city || "",
      Sector: inv.route || "",
      Subtotal: Number(inv.subtotal),
      "Trade discount": Number(inv.discount_total),
      "Extra discount": Number(inv.extra_discount || 0),
      Total: Number(inv.grand_total),
      Paid: Number(inv.amount_paid),
      _href: `/sales/invoices/${inv.id}`,
    };
  });
}

async function buildExpiryCreditReport(
  supabase: SupabaseClient,
  filters: Filters,
) {
  let query = supabase
    .from("expiry_receipts")
    .select(
      "id, receipt_no, receipt_date, grand_total, party_id, parties(party_code, name_en)",
    )
    .eq("company_id", filters.companyId)
    .eq("status", "posted")
    .gte("receipt_date", filters.from)
    .lte("receipt_date", filters.to)
    .order("receipt_date", { ascending: true })
    .limit(2000);

  if (filters.walkInOnly) {
    if (!filters.walkInPartyId) {
      return [];
    }
    query = query.eq("party_id", filters.walkInPartyId);
  } else if (filters.partyIds?.length) {
    query = query.in("party_id", filters.partyIds);
  }

  const { data: receipts, error } = await query;
  if (error) throw new Error(error.message);
  if (!receipts?.length) return [];

  const { data: items, error: itemError } = await supabase
    .from("expiry_receipt_items")
    .select(
      "receipt_id, product_id, product_code, product_name, qty, rate, amount, products(default_warehouse_id)",
    )
    .in(
      "receipt_id",
      receipts.map((r) => r.id),
    );
  if (itemError) throw new Error(itemError.message);

  const warehouseFilter = new Set(filters.warehouseIds || []);
  const needNames = new Set<string>();
  for (const it of items || []) {
    const wid = one(it.products)?.default_warehouse_id;
    if (wid) needNames.add(wid);
  }
  const whNameById = new Map<string, string>();
  if (needNames.size) {
    const { data: whRows } = await supabase
      .from("warehouses")
      .select("id, name")
      .in("id", [...needNames]);
    for (const w of whRows || []) {
      whNameById.set(w.id, w.name);
    }
  }

  const receiptMap = new Map(receipts.map((r) => [r.id, r]));
  return (items || [])
    .map((it) => {
      const doc = receiptMap.get(it.receipt_id);
      if (!matchesProductFilter(it.product_id, filters.productIds)) {
        return null;
      }
      const product = one(it.products);
      const warehouseId = product?.default_warehouse_id as string | null;
      if (warehouseFilter.size && (!warehouseId || !warehouseFilter.has(warehouseId))) {
        return null;
      }
      const party = one(doc?.parties);
      return {
        Date: doc?.receipt_date,
        No: doc?.receipt_no,
        Customer: party ? `${party.party_code} — ${party.name_en}` : "",
        Company: (warehouseId && whNameById.get(warehouseId)) || "—",
        Code: it.product_code,
        Item: it.product_name,
        Qty: Number(it.qty),
        Rate: Number(it.rate),
        Amount: Number(it.amount),
        _href: doc?.id ? `/inventory/expiry/receipts/${doc.id}` : "",
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
}


import { formatReportDate, formatReportInvNo, one } from "@/lib/reports/helpers";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Keep `.in(uuid[])` URLs under proxy limits (~100–150 ids). */
const ID_CHUNK = 120;

async function loadInChunks<T>(
  ids: string[],
  load: (chunk: string[]) => Promise<T[]>,
  chunkSize = ID_CHUNK,
): Promise<T[]> {
  if (!ids.length) return [];
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    out.push(...(await load(ids.slice(i, i + chunkSize))));
  }
  return out;
}

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

type SaleInvoiceRow = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  payment_type: string | null;
  grand_total: number | null;
  amount_paid: number | null;
  discount_total: number | null;
  extra_discount: number | null;
  subtotal: number | null;
  city: string | null;
  route: string | null;
  created_by: string | null;
  salesman_id: string | null;
  party_id: string | null;
  warehouse_id: string | null;
  parties:
    | {
        party_code: string | null;
        name_en: string | null;
        address: string | null;
        city: string | null;
        route: string | null;
        head: string | null;
      }
    | {
        party_code: string | null;
        name_en: string | null;
        address: string | null;
        city: string | null;
        route: string | null;
        head: string | null;
      }[]
    | null;
  warehouses: { name: string | null } | { name: string | null }[] | null;
  salesman: { id: string; full_name: string | null } | { id: string; full_name: string | null }[] | null;
};

type SaleItemRow = {
  sale_invoice_id: string;
  product_code: string | null;
  product_name: string | null;
  qty: number | null;
  rate: number | null;
  discount: number | null;
  amount: number | null;
  product_id: string | null;
  products:
    | { purchase_rate: number | null; default_warehouse_id: string | null }
    | { purchase_rate: number | null; default_warehouse_id: string | null }[]
    | null;
};

function invoiceRoute(inv: SaleInvoiceRow) {
  const party = one(inv.parties);
  return (inv.route || party?.route || "").trim();
}

function invoiceCity(inv: SaleInvoiceRow) {
  const party = one(inv.parties);
  return (inv.city || party?.city || party?.head || "").trim();
}

function invoiceMatchesRoutes(inv: SaleInvoiceRow, routes?: string[]) {
  if (!routes?.length) return true;
  const party = one(inv.parties);
  const values = [inv.route, party?.route]
    .map((v) => (v || "").trim())
    .filter(Boolean);
  return values.some((v) => routes.includes(v));
}

function invoiceMatchesCities(inv: SaleInvoiceRow, cities?: string[]) {
  if (!cities?.length) return true;
  const party = one(inv.parties);
  const values = [inv.city, party?.city, party?.head]
    .map((v) => (v || "").trim())
    .filter(Boolean);
  return values.some((v) => cities.includes(v));
}

async function fetchSaleInvoiceItems(
  supabase: SupabaseClient,
  invoiceIds: string[],
  productIds?: string[],
) {
  return loadInChunks(invoiceIds, async (chunk) => {
    const rows = await fetchAllPages<SaleItemRow>((from, to) => {
      let q = supabase
        .from("sale_invoice_items")
        .select(
          "sale_invoice_id, product_code, product_name, qty, rate, discount, amount, product_id, products(purchase_rate, default_warehouse_id)",
        )
        .in("sale_invoice_id", chunk)
        .order("sale_invoice_id", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
      if (productIds?.length) {
        // Chunk product filter separately when many ids selected.
        if (productIds.length <= ID_CHUNK) {
          q = q.in("product_id", productIds);
        }
      }
      return q;
    });
    if (productIds?.length && productIds.length > ID_CHUNK) {
      const allowed = new Set(productIds);
      return rows.filter((r) => r.product_id && allowed.has(r.product_id));
    }
    return rows;
  });
}

export async function buildSaleReport(
  supabase: SupabaseClient,
  filters: Filters,
) {
  if (filters.type === "expiry_credits") {
    return buildExpiryCreditReport(supabase, filters);
  }

  const applyHeaderWarehouse =
    Boolean(filters.warehouseIds?.length) &&
    !LINE_COMPANY_TYPES.includes(filters.type);

  let list = await fetchAllPages<SaleInvoiceRow>((from, to) => {
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
      .order("id", { ascending: true })
      .range(from, to);

    if (applyHeaderWarehouse && filters.warehouseIds!.length <= ID_CHUNK) {
      query = query.in("warehouse_id", filters.warehouseIds!);
    }
    if (filters.walkInOnly) {
      if (!filters.walkInPartyId) {
        // Caller still needs an empty page shape from fetchAllPages.
        query = query.eq("party_id", "00000000-0000-0000-0000-000000000000");
      } else {
        query = query.eq("party_id", filters.walkInPartyId);
      }
    } else if (filters.partyIds?.length && filters.partyIds.length <= ID_CHUNK) {
      query = query.in("party_id", filters.partyIds);
    }
    if (filters.type === "cash_sales") query = query.eq("payment_type", "cash");
    if (filters.type === "credit_sales") {
      query = query.in("payment_type", ["credit", "partial"]);
    }
    return query;
  });

  if (filters.walkInOnly && !filters.walkInPartyId) {
    return [];
  }

  if (
    applyHeaderWarehouse &&
    filters.warehouseIds &&
    filters.warehouseIds.length > ID_CHUNK
  ) {
    const allowed = new Set(filters.warehouseIds);
    list = list.filter((inv) => inv.warehouse_id && allowed.has(inv.warehouse_id));
  } else if (
    !applyHeaderWarehouse &&
    filters.warehouseIds?.length &&
    filters.warehouseIds.length > ID_CHUNK
  ) {
    // Line-level company types filter later per product brand.
  }

  if (
    !filters.walkInOnly &&
    filters.partyIds?.length &&
    filters.partyIds.length > ID_CHUNK
  ) {
    const allowed = new Set(filters.partyIds);
    list = list.filter((inv) => inv.party_id && allowed.has(inv.party_id));
  }

  // Sector / city options come from parties — match invoice stamp OR party profile.
  if (filters.routes?.length) {
    list = list.filter((inv) => invoiceMatchesRoutes(inv, filters.routes));
  }
  if (filters.cities?.length) {
    list = list.filter((inv) => invoiceMatchesCities(inv, filters.cities));
  }

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
    const matchRows = await loadInChunks(list.map((i) => i.id), async (chunk) => {
      return loadInChunks(filters.productIds!, async (productChunk) => {
        const { data, error } = await supabase
          .from("sale_invoice_items")
          .select("sale_invoice_id")
          .in("sale_invoice_id", chunk)
          .in("product_id", productChunk);
        if (error) throw new Error(error.message);
        return data || [];
      });
    });
    const matchIds = new Set(matchRows.map((r) => r.sale_invoice_id));
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
    const items = await fetchSaleInvoiceItems(
      supabase,
      ids,
      filters.productIds,
    );

    // Backfill brand/cost when the products embed is missing (RLS / orphan lines).
    const missingProductIds = [
      ...new Set(
        items
          .filter((it) => it.product_id && !one(it.products))
          .map((it) => String(it.product_id)),
      ),
    ];
    if (missingProductIds.length) {
      const productRows = await loadInChunks(missingProductIds, async (chunk) => {
        const { data, error } = await supabase
          .from("products")
          .select("id, purchase_rate, default_warehouse_id")
          .in("id", chunk);
        if (error) throw new Error(error.message);
        return data || [];
      });
      const productById = new Map(
        productRows.map((p) => [
          p.id,
          {
            purchase_rate: p.purchase_rate as number | null,
            default_warehouse_id: p.default_warehouse_id as string | null,
          },
        ]),
      );
      for (const it of items) {
        if (it.product_id && !one(it.products)) {
          const fallback = productById.get(it.product_id);
          if (fallback) it.products = fallback;
        }
      }
    }

    const invMap = new Map(list.map((i) => [i.id, i]));

    if (filters.type === "cash_flow") {
      // Company (product brand) → top customers → invoices
      type LineBucket = {
        invoiceId: string;
        date: string;
        invoiceNo: string;
        paymentType: string;
        productCode: string;
        productName: string;
        qty: number;
        amount: number;
        cash: number;
        credit: number;
      };
      type PartyBucket = {
        partyId: string;
        partyCode: string;
        partyName: string;
        lines: Map<string, LineBucket>;
        amount: number;
        qty: number;
      };
      type CompanyBucket = {
        warehouseId: string;
        companyName: string;
        parties: Map<string, PartyBucket>;
        amount: number;
      };

      const whIds = new Set<string>();
      for (const it of items) {
        const product = one(it.products);
        const inv = invMap.get(it.sale_invoice_id);
        const wid = product?.default_warehouse_id || inv?.warehouse_id;
        if (wid) whIds.add(wid);
      }
      const whNameById = new Map<string, string>();
      if (whIds.size) {
        const whRows = await loadInChunks([...whIds], async (chunk) => {
          const { data, error } = await supabase
            .from("warehouses")
            .select("id, name")
            .in("id", chunk);
          if (error) throw new Error(error.message);
          return data || [];
        });
        for (const w of whRows) {
          whNameById.set(w.id, w.name);
        }
      }

      const companies = new Map<string, CompanyBucket>();
      const warehouseFilter = new Set(filters.warehouseIds || []);

      for (const it of items) {
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
        const lineQty = Number(it.qty || 0);
        const productCode = it.product_code || "";
        const productName = (it.product_name || "").toUpperCase();

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
            lines: new Map(),
            amount: 0,
            qty: 0,
          };
          company.parties.set(partyId, partyBucket);
        }

        const lineAmount = Number(it.amount || 0);
        const billTotal = Number(inv.grand_total || 0);
        const paid = Number(inv.amount_paid || 0);
        const cashShare =
          billTotal > 0 ? (lineAmount / billTotal) * paid : 0;
        const creditShare = lineAmount - cashShare;
        const lineKey = `${inv.id}:${it.product_id || productCode || "item"}`;
        let line = partyBucket.lines.get(lineKey);
        if (!line) {
          line = {
            invoiceId: inv.id,
            date: inv.invoice_date,
            invoiceNo: inv.invoice_no,
            paymentType: inv.payment_type || "credit",
            productCode,
            productName,
            qty: 0,
            amount: 0,
            cash: 0,
            credit: 0,
          };
          partyBucket.lines.set(lineKey, line);
        }

        line.qty += lineQty;
        line.amount += lineAmount;
        line.cash += cashShare;
        line.credit += creditShare;
        partyBucket.qty += lineQty;
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
          const lines = [...party.lines.values()].sort((a, b) => {
            const d = a.date.localeCompare(b.date);
            if (d) return d;
            const invCmp = a.invoiceNo.localeCompare(b.invoiceNo);
            if (invCmp) return invCmp;
            return a.productName.localeCompare(b.productName);
          });
          for (const line of lines) {
            const productLabel = [line.productCode, line.productName]
              .filter(Boolean)
              .join(" — ");
            rows.push({
              Date: formatReportDate(line.date),
              "Inv No.": formatReportInvNo(line.invoiceNo),
              Product: productLabel,
              Qty: line.qty,
              Type: String(line.paymentType || "").toUpperCase(),
              "Sale amount": Math.round(line.amount * 100) / 100,
              "Cash received": Math.round(line.cash * 100) / 100,
              "Credit balance": Math.round(line.credit * 100) / 100,
              _company: company.companyName,
              _company_amount: company.amount,
              _party_id: party.partyId,
              _party_code: party.partyCode,
              _party_name: party.partyName,
              _party_amount: party.amount,
              _party_qty: party.qty,
              _party_rank: rank + 1,
              _href: `/sales/invoices/${line.invoiceId}`,
              _sort_date: line.date,
            });
          }
        });
      }
      return rows;
    }

    if (filters.type === "party_wise") {
      const warehouseIds = filters.warehouseIds;
      const detail = items
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
      return items
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
      for (const it of items) {
        const product = one(it.products);
        const inv = invMap.get(it.sale_invoice_id);
        const wid = product?.default_warehouse_id || inv?.warehouse_id;
        if (wid) whIds.add(wid);
      }
      const whNameById = new Map<string, string>();
      if (whIds.size) {
        const whRows = await loadInChunks([...whIds], async (chunk) => {
          const { data, error } = await supabase
            .from("warehouses")
            .select("id, name")
            .in("id", chunk);
          if (error) throw new Error(error.message);
          return data || [];
        });
        for (const w of whRows) {
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

      for (const it of items) {
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

      let returnDocs = await fetchAllPages<{
        id: string;
        party_id: string | null;
        warehouse_id: string | null;
        parties:
          | { city: string | null; route: string | null; head?: string | null }
          | { city: string | null; route: string | null; head?: string | null }[]
          | null;
      }>((from, to) => {
        let returnQuery = supabase
          .from("sale_returns")
          .select("id, party_id, warehouse_id, parties(city, route, head)")
          .eq("company_id", filters.companyId)
          .eq("status", "posted")
          .gte("return_date", filters.from)
          .lte("return_date", filters.to)
          .order("return_date", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        if (filters.walkInOnly && filters.walkInPartyId) {
          returnQuery = returnQuery.eq("party_id", filters.walkInPartyId);
        } else if (
          filters.partyIds?.length &&
          filters.partyIds.length <= ID_CHUNK
        ) {
          returnQuery = returnQuery.in("party_id", filters.partyIds);
        }
        return returnQuery;
      });
      if (
        !filters.walkInOnly &&
        filters.partyIds?.length &&
        filters.partyIds.length > ID_CHUNK
      ) {
        const allowed = new Set(filters.partyIds);
        returnDocs = returnDocs.filter(
          (doc) => doc.party_id && allowed.has(doc.party_id),
        );
      }
      returnDocs = returnDocs.filter((doc) => {
        const party = one(doc.parties);
        const route = (party?.route || "").trim();
        const city = (party?.city || party?.head || "").trim();
        if (filters.routes?.length && !filters.routes.includes(route)) {
          return false;
        }
        if (filters.cities?.length && !filters.cities.includes(city)) {
          return false;
        }
        return true;
      });
      if (returnDocs.length) {
        const returnItems = await loadInChunks(
          returnDocs.map((doc) => doc.id),
          async (chunk) => {
            const rows = await fetchAllPages<{
              sale_return_id: string;
              product_id: string | null;
              qty: number | null;
              amount: number | null;
              products:
                | {
                    purchase_rate: number | null;
                    default_warehouse_id: string | null;
                  }
                | {
                    purchase_rate: number | null;
                    default_warehouse_id: string | null;
                  }[]
                | null;
            }>((from, to) => {
              let q = supabase
                .from("sale_return_items")
                .select(
                  "sale_return_id, product_id, qty, amount, products(purchase_rate, default_warehouse_id)",
                )
                .in("sale_return_id", chunk)
                .order("sale_return_id", { ascending: true })
                .order("id", { ascending: true })
                .range(from, to);
              if (
                filters.productIds?.length &&
                filters.productIds.length <= ID_CHUNK
              ) {
                q = q.in("product_id", filters.productIds);
              }
              return q;
            });
            if (
              filters.productIds?.length &&
              filters.productIds.length > ID_CHUNK
            ) {
              const allowed = new Set(filters.productIds);
              return rows.filter((r) => r.product_id && allowed.has(r.product_id));
            }
            return rows;
          },
        );
        const returnMap = new Map(returnDocs.map((doc) => [doc.id, doc]));
        const missingWh = [
          ...new Set(
            returnItems
              .map((it) => one(it.products)?.default_warehouse_id)
              .filter(
                (id): id is string =>
                  typeof id === "string" &&
                  id.length > 0 &&
                  !whNameById.has(id),
              ),
          ),
        ];
        if (missingWh.length) {
          const extraWh = await loadInChunks(missingWh, async (chunk) => {
            const { data, error } = await supabase
              .from("warehouses")
              .select("id, name")
              .in("id", chunk);
            if (error) throw new Error(error.message);
            return data || [];
          });
          for (const w of extraWh) whNameById.set(w.id, w.name);
        }
        for (const it of returnItems) {
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
      return items
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
      const key = invoiceCity(inv) || "No city";
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
      const key = invoiceRoute(inv) || "No sector";
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
      City: invoiceCity(inv),
      Sector: invoiceRoute(inv),
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
  if (filters.walkInOnly && !filters.walkInPartyId) {
    return [];
  }

  let receipts = await fetchAllPages<{
    id: string;
    receipt_no: string | null;
    receipt_date: string | null;
    grand_total: number | null;
    party_id: string | null;
    parties:
      | { party_code: string | null; name_en: string | null }
      | { party_code: string | null; name_en: string | null }[]
      | null;
  }>((from, to) => {
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
      .order("id", { ascending: true })
      .range(from, to);

    if (filters.walkInOnly && filters.walkInPartyId) {
      query = query.eq("party_id", filters.walkInPartyId);
    } else if (
      filters.partyIds?.length &&
      filters.partyIds.length <= ID_CHUNK
    ) {
      query = query.in("party_id", filters.partyIds);
    }
    return query;
  });

  if (
    !filters.walkInOnly &&
    filters.partyIds?.length &&
    filters.partyIds.length > ID_CHUNK
  ) {
    const allowed = new Set(filters.partyIds);
    receipts = receipts.filter((r) => r.party_id && allowed.has(r.party_id));
  }
  if (!receipts.length) return [];

  const items = await loadInChunks(
    receipts.map((r) => r.id),
    async (chunk) => {
      const rows = await fetchAllPages<{
        receipt_id: string;
        product_id: string | null;
        product_code: string | null;
        product_name: string | null;
        qty: number | null;
        rate: number | null;
        amount: number | null;
        products:
          | { default_warehouse_id: string | null }
          | { default_warehouse_id: string | null }[]
          | null;
      }>((from, to) => {
        let q = supabase
          .from("expiry_receipt_items")
          .select(
            "receipt_id, product_id, product_code, product_name, qty, rate, amount, products(default_warehouse_id)",
          )
          .in("receipt_id", chunk)
          .order("receipt_id", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        if (
          filters.productIds?.length &&
          filters.productIds.length <= ID_CHUNK
        ) {
          q = q.in("product_id", filters.productIds);
        }
        return q;
      });
      if (filters.productIds?.length && filters.productIds.length > ID_CHUNK) {
        const allowed = new Set(filters.productIds);
        return rows.filter((r) => r.product_id && allowed.has(r.product_id));
      }
      return rows;
    },
  );

  const warehouseFilter = new Set(filters.warehouseIds || []);
  const needNames = new Set<string>();
  for (const it of items) {
    const wid = one(it.products)?.default_warehouse_id;
    if (wid) needNames.add(wid);
  }
  const whNameById = new Map<string, string>();
  if (needNames.size) {
    const whRows = await loadInChunks([...needNames], async (chunk) => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name")
        .in("id", chunk);
      if (error) throw new Error(error.message);
      return data || [];
    });
    for (const w of whRows) {
      whNameById.set(w.id, w.name);
    }
  }

  const receiptMap = new Map(receipts.map((r) => [r.id, r]));
  return items
    .map((it) => {
      const doc = receiptMap.get(it.receipt_id);
      if (!matchesProductFilter(it.product_id, filters.productIds)) {
        return null;
      }
      const product = one(it.products);
      const warehouseId = product?.default_warehouse_id as string | null;
      if (
        warehouseFilter.size &&
        (!warehouseId || !warehouseFilter.has(warehouseId))
      ) {
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


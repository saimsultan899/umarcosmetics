import { one } from "@/lib/reports/helpers";
import type { SupabaseClient } from "@supabase/supabase-js";

const TZ = "Asia/Karachi";

export type CompanyStatement = {
  warehouseName: string;
  openingQty: number;
  openingValue: number;
  closingQty: number;
  closingValue: number;
  purchaseQty: number;
  purchaseAmount: number;
  saleQty: number;
  saleAmount: number;
  summary: Record<string, unknown>[];
  lines: Record<string, unknown>[];
};

type Movement = {
  product_id: string;
  move_type: string;
  qty: number;
  ref_table: string;
  ref_id: string;
  created_at: string;
};

type DocInfo = {
  date: string;
  no: string;
  party: string;
  href: string;
};

function dayKey(value: string) {
  if (/^\d{4}-\d{2}-\d{2}/.test(value) && value.length === 10) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function partyLabel(row: { party_code?: string; name_en?: string } | null) {
  if (!row) return "";
  return [row.party_code, row.name_en].filter(Boolean).join(" — ");
}

async function loadIds<T>(
  ids: string[],
  load: (chunk: string[]) => Promise<T[]>,
) {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    out.push(...(await load(ids.slice(i, i + 150))));
  }
  return out;
}

function typeLabel(moveType: string, refTable: string) {
  if (moveType === "purchase") return "Purchase";
  if (moveType === "sale") return "Sale";
  if (moveType === "sale_return") return "Sale return";
  if (moveType === "purchase_return") return "Purchase return";
  if (refTable === "expiry_claims") return "Expiry claim";
  if (moveType === "adjustment" && refTable === "products") return "Opening / adjustment";
  if (moveType === "adjustment") return "Stock adjustment";
  return moveType.replaceAll("_", " ");
}

function hrefFor(refTable: string, refId: string) {
  if (refTable === "sale_invoices") return `/sales/invoices/${refId}`;
  if (refTable === "purchase_invoices") return `/purchases/invoices/${refId}`;
  if (refTable === "sale_returns") return `/sales/returns/${refId}`;
  if (refTable === "purchase_returns") return `/purchases/returns/${refId}`;
  if (refTable === "expiry_claims") return `/inventory/expiry?tab=claims`;
  return "";
}

export async function buildCompanyStatement(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    warehouseId: string;
    from: string;
    to: string;
  },
): Promise<CompanyStatement> {
  const { companyId, warehouseId, from, to } = input;

  const [{ data: warehouse, error: whError }, { data: balances, error: balError }, { data: movementRows, error: moveError }] =
    await Promise.all([
      supabase.from("warehouses").select("id, name").eq("id", warehouseId).maybeSingle(),
      supabase
        .from("stock_balances")
        .select("product_id, qty")
        .eq("company_id", companyId)
        .eq("warehouse_id", warehouseId)
        .limit(20000),
      supabase
        .from("stock_movements")
        .select("product_id, move_type, qty, ref_table, ref_id, created_at")
        .eq("company_id", companyId)
        .eq("warehouse_id", warehouseId)
        .order("created_at", { ascending: true })
        .limit(20000),
    ]);

  if (whError) throw new Error(whError.message);
  if (balError) throw new Error(balError.message);
  if (moveError) throw new Error(moveError.message);

  const movements: Movement[] = (movementRows || []).map((row) => ({
    product_id: String(row.product_id),
    move_type: String(row.move_type || ""),
    qty: Number(row.qty || 0),
    ref_table: String(row.ref_table || ""),
    ref_id: String(row.ref_id || ""),
    created_at: String(row.created_at || ""),
  }));

  const productIds = [
    ...new Set([
      ...(balances || []).map((r) => String(r.product_id)),
      ...movements.map((m) => m.product_id),
    ]),
  ].filter(Boolean);

  const products = await loadIds(productIds, async (chunk) => {
    const { data, error } = await supabase
      .from("products")
      .select("id, purchase_rate")
      .in("id", chunk);
    if (error) throw new Error(error.message);
    return data || [];
  });
  const rateByProduct = new Map(
    products.map((p) => [String(p.id), Number(p.purchase_rate || 0)]),
  );

  const idsFor = (table: string) =>
    [...new Set(movements.filter((m) => m.ref_table === table && m.ref_id).map((m) => m.ref_id))];

  const [saleDocs, purchaseDocs, saleReturnDocs, purchaseReturnDocs] = await Promise.all([
    loadIds(idsFor("sale_invoices"), async (chunk) => {
      const { data, error } = await supabase
        .from("sale_invoices")
        .select("id, invoice_no, invoice_date, parties(party_code, name_en)")
        .in("id", chunk);
      if (error) throw new Error(error.message);
      return data || [];
    }),
    loadIds(idsFor("purchase_invoices"), async (chunk) => {
      const { data, error } = await supabase
        .from("purchase_invoices")
        .select("id, invoice_no, invoice_date, supplier_bill_no, parties(party_code, name_en)")
        .in("id", chunk);
      if (error) throw new Error(error.message);
      return data || [];
    }),
    loadIds(idsFor("sale_returns"), async (chunk) => {
      const { data, error } = await supabase
        .from("sale_returns")
        .select("id, return_no, return_date, parties(party_code, name_en)")
        .in("id", chunk);
      if (error) throw new Error(error.message);
      return data || [];
    }),
    loadIds(idsFor("purchase_returns"), async (chunk) => {
      const { data, error } = await supabase
        .from("purchase_returns")
        .select("id, return_no, return_date, parties(party_code, name_en)")
        .in("id", chunk);
      if (error) throw new Error(error.message);
      return data || [];
    }),
  ]);

  const docs = new Map<string, DocInfo>();
  for (const row of saleDocs) {
    docs.set(`sale_invoices:${row.id}`, {
      date: String(row.invoice_date || ""),
      no: String(row.invoice_no || ""),
      party: partyLabel(one(row.parties) as { party_code?: string; name_en?: string } | null),
      href: `/sales/invoices/${row.id}`,
    });
  }
  for (const row of purchaseDocs) {
    const bill = String(row.supplier_bill_no || "").trim();
    docs.set(`purchase_invoices:${row.id}`, {
      date: String(row.invoice_date || ""),
      no: bill ? `${row.invoice_no} · ${bill}` : String(row.invoice_no || ""),
      party: partyLabel(one(row.parties) as { party_code?: string; name_en?: string } | null),
      href: `/purchases/invoices/${row.id}`,
    });
  }
  for (const row of saleReturnDocs) {
    docs.set(`sale_returns:${row.id}`, {
      date: String(row.return_date || ""),
      no: String(row.return_no || ""),
      party: partyLabel(one(row.parties) as { party_code?: string; name_en?: string } | null),
      href: `/sales/returns/${row.id}`,
    });
  }
  for (const row of purchaseReturnDocs) {
    docs.set(`purchase_returns:${row.id}`, {
      date: String(row.return_date || ""),
      no: String(row.return_no || ""),
      party: partyLabel(one(row.parties) as { party_code?: string; name_en?: string } | null),
      href: `/purchases/returns/${row.id}`,
    });
  }

  const amountKey = (refId: string, productId: string) => `${refId}:${productId}`;
  const lineAmount = new Map<string, number>();

  async function addLineAmounts(
    refIds: string[],
    table: "sale_invoice_items" | "purchase_invoice_items" | "sale_return_items" | "purchase_return_items",
    refColumn: string,
  ) {
    const rows = await loadIds(refIds, async (chunk) => {
      const { data, error } = await supabase
        .from(table)
        .select(`${refColumn}, product_id, amount`)
        .in(refColumn, chunk);
      if (error) throw new Error(error.message);
      return (data || []) as unknown as Array<Record<string, unknown>>;
    });
    for (const row of rows) {
      const key = amountKey(String(row[refColumn] || ""), String(row.product_id || ""));
      lineAmount.set(key, (lineAmount.get(key) || 0) + Number(row.amount || 0));
    }
  }

  await Promise.all([
    addLineAmounts(idsFor("sale_invoices"), "sale_invoice_items", "sale_invoice_id"),
    addLineAmounts(idsFor("purchase_invoices"), "purchase_invoice_items", "purchase_invoice_id"),
    addLineAmounts(idsFor("sale_returns"), "sale_return_items", "sale_return_id"),
    addLineAmounts(idsFor("purchase_returns"), "purchase_return_items", "purchase_return_id"),
  ]);

  const currentQty = new Map<string, number>();
  for (const row of balances || []) {
    currentQty.set(String(row.product_id), Number(row.qty || 0));
  }

  function effectiveDate(move: Movement) {
    const doc = docs.get(`${move.ref_table}:${move.ref_id}`);
    return dayKey(doc?.date || move.created_at);
  }

  let openingQty = 0;
  let openingValue = 0;
  let closingQty = 0;
  let closingValue = 0;
  const movesByProduct = new Map<string, Movement[]>();
  for (const move of movements) {
    const list = movesByProduct.get(move.product_id) || [];
    list.push(move);
    movesByProduct.set(move.product_id, list);
  }
  const seenProducts = new Set<string>([
    ...currentQty.keys(),
    ...movesByProduct.keys(),
  ]);
  for (const productId of seenProducts) {
    const current = currentQty.get(productId) || 0;
    const rate = rateByProduct.get(productId) || 0;
    let afterFrom = 0;
    let afterTo = 0;
    for (const move of movesByProduct.get(productId) || []) {
      const date = effectiveDate(move);
      if (date >= from) afterFrom += move.qty;
      if (date > to) afterTo += move.qty;
    }
    const opening = current - afterFrom;
    const closing = current - afterTo;
    openingQty += opening;
    openingValue += opening * rate;
    closingQty += closing;
    closingValue += closing * rate;
  }

  type Bucket = {
    qtyIn: number;
    qtyOut: number;
    value: number;
    amount: number;
    bills: Set<string>;
  };
  const buckets = new Map<string, Bucket>();
  function bucket(name: string) {
    const cur = buckets.get(name) || {
      qtyIn: 0,
      qtyOut: 0,
      value: 0,
      amount: 0,
      bills: new Set<string>(),
    };
    buckets.set(name, cur);
    return cur;
  }

  const covered = new Set<string>();
  const lines: Array<Record<string, unknown> & { _sort: string }> = [];

  for (const move of movements) {
    const date = effectiveDate(move);
    if (date < from || date > to) continue;
    const doc = docs.get(`${move.ref_table}:${move.ref_id}`);
    const rate = rateByProduct.get(move.product_id) || 0;
    const useBill =
      (move.move_type === "sale" && move.ref_table === "sale_invoices") ||
      (move.move_type === "purchase" && move.ref_table === "purchase_invoices") ||
      (move.move_type === "sale_return" && move.ref_table === "sale_returns") ||
      (move.move_type === "purchase_return" && move.ref_table === "purchase_returns");
    const bill = useBill
      ? lineAmount.get(amountKey(move.ref_id, move.product_id))
      : undefined;
    const amount = bill != null ? bill : Math.abs(move.qty) * rate;
    const label = typeLabel(move.move_type, move.ref_table);
    const slot = bucket(label);
    if (move.qty >= 0) slot.qtyIn += move.qty;
    else slot.qtyOut += Math.abs(move.qty);
    slot.value += move.qty * rate;
    slot.amount += amount;
    if (
      (move.move_type === "purchase" || move.move_type === "sale") &&
      move.ref_id
    ) {
      slot.bills.add(move.ref_id);
    }
    covered.add(`${move.ref_table}:${move.ref_id}:${move.product_id}`);
    lines.push({
      _sort: `${date}|${label}|${doc?.no || ""}`,
      Date: date,
      Type: label,
      Document: doc?.no || "—",
      "Vendor / customer": doc?.party || "",
      Qty: move.qty,
      "Purchase value": move.qty * rate,
      Amount: amount,
      _href: doc?.href || hrefFor(move.ref_table, move.ref_id),
    });
  }

  await addDocumentLines({
    supabase,
    companyId,
    warehouseId,
    from,
    to,
    covered,
    lines,
    bucket,
    rateByProduct,
  });
  await addPurchaseBills({
    supabase,
    companyId,
    warehouseId,
    from,
    to,
    covered,
    lines,
    bucket,
    rateByProduct,
  });

  lines.sort((a, b) => String(a._sort).localeCompare(String(b._sort)));
  const movementLines = lines.map(({ _sort: _ignored, ...row }) => row);

  const order = [
    "Purchase",
    "Sale return",
    "Opening / adjustment",
    "Stock adjustment",
    "Sale",
    "Purchase return",
    "Expiry claim",
  ];
  const summary: Record<string, unknown>[] = [
    {
      Line: "Opening stock",
      Bills: "",
      "Qty in": openingQty,
      "Qty out": "",
      "Purchase value": openingValue,
      Amount: "",
    },
  ];
  for (const name of order) {
    const slot = buckets.get(name);
    if (!slot) continue;
    summary.push({
      Line: name,
      Bills: slot.bills.size || "",
      "Qty in": slot.qtyIn || "",
      "Qty out": slot.qtyOut || "",
      "Purchase value": slot.value,
      Amount: slot.amount,
    });
  }
  for (const [name, slot] of buckets) {
    if (order.includes(name)) continue;
    summary.push({
      Line: name,
      Bills: slot.bills.size || "",
      "Qty in": slot.qtyIn || "",
      "Qty out": slot.qtyOut || "",
      "Purchase value": slot.value,
      Amount: slot.amount,
    });
  }
  summary.push({
    Line: "Closing stock",
    Bills: "",
    "Qty in": closingQty,
    "Qty out": "",
    "Purchase value": closingValue,
    Amount: "",
  });

  const purchase = buckets.get("Purchase");
  const sale = buckets.get("Sale");

  return {
    warehouseName: warehouse?.name || "Company",
    openingQty,
    openingValue,
    closingQty,
    closingValue,
    purchaseQty: purchase?.qtyIn || 0,
    purchaseAmount: purchase?.amount || 0,
    saleQty: sale?.qtyOut || 0,
    saleAmount: sale?.amount || 0,
    summary,
    lines: movementLines,
  };
}

async function addDocumentLines(args: {
  supabase: SupabaseClient;
  companyId: string;
  warehouseId: string;
  from: string;
  to: string;
  covered: Set<string>;
  lines: Array<Record<string, unknown> & { _sort: string }>;
  bucket: (name: string) => {
    qtyIn: number;
    qtyOut: number;
    value: number;
    amount: number;
    bills: Set<string>;
  };
  rateByProduct: Map<string, number>;
}) {
  const { supabase, companyId, warehouseId, from, to, covered, lines, bucket, rateByProduct } =
    args;

  const [{ data: purchaseReturns }, { data: claims }] = await Promise.all([
    supabase
      .from("purchase_returns")
      .select("id, return_no, return_date, warehouse_id, parties(party_code, name_en)")
      .eq("company_id", companyId)
      .eq("status", "posted")
      .gte("return_date", from)
      .lte("return_date", to)
      .limit(2000),
    supabase
      .from("expiry_claims")
      .select("id, claim_no, claim_date, warehouse_id, parties(party_code, name_en)")
      .eq("company_id", companyId)
      .eq("status", "posted")
      .gte("claim_date", from)
      .lte("claim_date", to)
      .limit(2000),
  ]);

  const returnHeaders = new Map(
    (purchaseReturns || []).map((row) => [String(row.id), row]),
  );
  const claimHeaders = new Map((claims || []).map((row) => [String(row.id), row]));

  const returnItems = await loadIds([...returnHeaders.keys()], async (chunk) => {
    const { data, error } = await supabase
      .from("purchase_return_items")
      .select("purchase_return_id, product_id, qty, amount, products(default_warehouse_id)")
      .in("purchase_return_id", chunk);
    if (error) throw new Error(error.message);
    return data || [];
  });
  const claimItems = await loadIds([...claimHeaders.keys()], async (chunk) => {
    const { data, error } = await supabase
      .from("expiry_claim_items")
      .select("claim_id, product_id, qty, amount, products(default_warehouse_id)")
      .in("claim_id", chunk);
    if (error) throw new Error(error.message);
    return data || [];
  });

  for (const item of returnItems) {
    const header = returnHeaders.get(String(item.purchase_return_id));
    const product = one(item.products) as { default_warehouse_id?: string | null } | null;
    const productCompany = product?.default_warehouse_id || header?.warehouse_id;
    if (productCompany !== warehouseId) continue;
    const productId = String(item.product_id || "");
    const key = `purchase_returns:${item.purchase_return_id}:${productId}`;
    if (covered.has(key)) continue;
    const qty = -Math.abs(Number(item.qty || 0));
    const amount = Number(item.amount || 0);
    const rate = rateByProduct.get(productId) || 0;
    const slot = bucket("Purchase return");
    slot.qtyOut += Math.abs(qty);
    slot.value += qty * rate;
    slot.amount += amount;
    const party = partyLabel(
      one(header?.parties) as { party_code?: string; name_en?: string } | null,
    );
    lines.push({
      _sort: `${header?.return_date || ""}|Purchase return|${header?.return_no || ""}`,
      Date: String(header?.return_date || ""),
      Type: "Purchase return",
      Document: String(header?.return_no || "—"),
      "Vendor / customer": party,
      Qty: qty,
      "Purchase value": qty * rate,
      Amount: amount,
      _href: `/purchases/returns/${item.purchase_return_id}`,
    });
  }

  for (const item of claimItems) {
    const header = claimHeaders.get(String(item.claim_id));
    const product = one(item.products) as { default_warehouse_id?: string | null } | null;
    const productCompany = product?.default_warehouse_id || header?.warehouse_id;
    if (productCompany !== warehouseId) continue;
    const productId = String(item.product_id || "");
    const key = `expiry_claims:${item.claim_id}:${productId}`;
    if (covered.has(key)) continue;
    const qty = -Math.abs(Number(item.qty || 0));
    const amount = Number(item.amount || 0);
    const rate = rateByProduct.get(productId) || 0;
    const slot = bucket("Expiry claim");
    slot.qtyOut += Math.abs(qty);
    slot.value += qty * rate;
    slot.amount += amount;
    const party = partyLabel(
      one(header?.parties) as { party_code?: string; name_en?: string } | null,
    );
    lines.push({
      _sort: `${header?.claim_date || ""}|Expiry claim|${header?.claim_no || ""}`,
      Date: String(header?.claim_date || ""),
      Type: "Expiry claim",
      Document: String(header?.claim_no || "—"),
      "Vendor / customer": party,
      Qty: qty,
      "Purchase value": qty * rate,
      Amount: amount,
      _href: "/inventory/expiry?tab=claims",
    });
  }
}

async function addPurchaseBills(args: {
  supabase: SupabaseClient;
  companyId: string;
  warehouseId: string;
  from: string;
  to: string;
  covered: Set<string>;
  lines: Array<Record<string, unknown> & { _sort: string }>;
  bucket: (name: string) => {
    qtyIn: number;
    qtyOut: number;
    value: number;
    amount: number;
    bills: Set<string>;
  };
  rateByProduct: Map<string, number>;
}) {
  const {
    supabase,
    companyId,
    warehouseId,
    from,
    to,
    covered,
    lines,
    bucket,
    rateByProduct,
  } = args;

  const { data: headers, error } = await supabase
    .from("purchase_invoices")
    .select(
      "id, invoice_no, invoice_date, supplier_bill_no, warehouse_id, parties(party_code, name_en)",
    )
    .eq("company_id", companyId)
    .eq("status", "posted")
    .gte("invoice_date", from)
    .lte("invoice_date", to)
    .limit(2000);
  if (error) throw new Error(error.message);
  if (!headers?.length) return;

  const headerById = new Map(headers.map((row) => [String(row.id), row]));
  const items = await loadIds([...headerById.keys()], async (chunk) => {
    const { data, error: itemError } = await supabase
      .from("purchase_invoice_items")
      .select(
        "purchase_invoice_id, product_id, qty, amount, products(purchase_rate, default_warehouse_id)",
      )
      .in("purchase_invoice_id", chunk);
    if (itemError) throw new Error(itemError.message);
    return data || [];
  });

  type Pending = {
    invoiceId: string;
    productId: string;
    qty: number;
    amount: number;
    rate: number;
  };
  const pending = new Map<string, Pending>();
  for (const item of items) {
    const header = headerById.get(String(item.purchase_invoice_id));
    const product = one(item.products) as {
      purchase_rate?: number | null;
      default_warehouse_id?: string | null;
    } | null;
    const productCompany = product?.default_warehouse_id || header?.warehouse_id;
    if (productCompany !== warehouseId) continue;
    const productId = String(item.product_id || "");
    const key = `purchase_invoices:${item.purchase_invoice_id}:${productId}`;
    if (covered.has(key)) continue;
    const rate = Number(product?.purchase_rate || rateByProduct.get(productId) || 0);
    if (!rateByProduct.has(productId)) rateByProduct.set(productId, rate);
    const cur = pending.get(key) || {
      invoiceId: String(item.purchase_invoice_id),
      productId,
      qty: 0,
      amount: 0,
      rate,
    };
    cur.qty += Number(item.qty || 0);
    cur.amount += Number(item.amount || 0);
    pending.set(key, cur);
  }

  for (const [key, row] of pending) {
    covered.add(key);
    const header = headerById.get(row.invoiceId);
    const billNo = String(header?.supplier_bill_no || "").trim();
    const docNo = billNo
      ? `${header?.invoice_no || ""} · ${billNo}`
      : String(header?.invoice_no || "—");
    const qty = row.qty;
    const slot = bucket("Purchase");
    slot.qtyIn += qty;
    slot.value += qty * row.rate;
    slot.amount += row.amount;
    slot.bills.add(row.invoiceId);
    const party = partyLabel(
      one(header?.parties) as { party_code?: string; name_en?: string } | null,
    );
    lines.push({
      _sort: `${header?.invoice_date || ""}|Purchase|${docNo}`,
      Date: String(header?.invoice_date || ""),
      Type: "Purchase",
      Document: docNo,
      "Vendor / customer": party,
      Qty: qty,
      "Purchase value": qty * row.rate,
      Amount: row.amount,
      _href: `/purchases/invoices/${row.invoiceId}`,
    });
  }
}

import { loadRows, offlineStockSnapshot } from "@/lib/offline/offline-reports";
import type { CompanyStatement } from "@/lib/reports/company-statement";

type Row = Record<string, unknown>;

type EventLine = {
  date: string;
  productId: string;
  qty: number;
  amount: number;
  value: number;
  type: string;
  doc: string;
  party: string;
  href: string;
  billId: string;
  pending: boolean;
};

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function day(value: unknown) {
  return String(value || "").slice(0, 10);
}

function linesOf(row: Row, keys: string[]) {
  const sources = [row];
  if (row.payload && typeof row.payload === "object") {
    sources.push(row.payload as Row);
  }
  for (const source of sources) {
    for (const key of keys) {
      const list = source[key];
      if (Array.isArray(list) && list.length) return list as Row[];
    }
  }
  return [] as Row[];
}

function partyName(
  row: Row,
  parties: Map<string, Row>,
) {
  const nested = row.parties as Row | Row[] | undefined;
  const party = Array.isArray(nested) ? nested[0] : nested;
  const cached = parties.get(String(row.party_id || ""));
  const code = String(party?.party_code || cached?.party_code || "");
  const name = String(party?.name_en || cached?.name_en || "");
  return [code, name].filter(Boolean).join(" — ");
}

function posted(row: Row) {
  const status = String(row.status || "posted");
  return status !== "cancelled" && status !== "voided" && status !== "draft";
}

function pending(row: Row) {
  return String(row.sync_status || "") === "pending";
}

export async function buildOfflineCompanyStatement(input: {
  companyId: string;
  warehouseId: string;
  from: string;
  to: string;
}): Promise<CompanyStatement> {
  const { companyId, warehouseId, from, to } = input;
  const [
    productRows,
    partyRows,
    warehouseRows,
    sales,
    purchases,
    saleReturns,
    purchaseReturns,
    claims,
    stock,
  ] = await Promise.all([
    loadRows("products", companyId),
    loadRows("parties", companyId),
    loadRows("warehouses", companyId),
    loadRows("sale_invoices", companyId),
    loadRows("purchase_invoices", companyId),
    loadRows("sale_returns", companyId),
    loadRows("purchase_returns", companyId),
    loadRows("expiry_claims", companyId),
    offlineStockSnapshot(companyId),
  ]);

  const products = new Map(productRows.map((row) => [String(row.id), row]));
  const parties = new Map(partyRows.map((row) => [String(row.id), row]));
  const warehouseName =
    String(warehouseRows.find((row) => String(row.id) === warehouseId)?.name || "") ||
    "Company";

  const events: EventLine[] = [];

  function pushLines(
    docs: Row[],
    spec: {
      dateKey: string;
      lineKeys: string[];
      type: string;
      sign: 1 | -1;
      no: (row: Row) => string;
      href: (row: Row) => string;
      bill?: boolean;
    },
  ) {
    for (const doc of docs) {
      if (!posted(doc)) continue;
      const date = day(doc[spec.dateKey] || doc.doc_date);
      if (!date) continue;
      const docNo = spec.no(doc);
      const party = partyName(doc, parties);
      const href = spec.href(doc);
      const isPending = pending(doc);
      for (const line of linesOf(doc, spec.lineKeys)) {
        const productId = String(line.product_id || "");
        const product = products.get(productId);
        const company =
          String(product?.default_warehouse_id || line.default_warehouse_id || "") ||
          String(doc.warehouse_id || "");
        if (company !== warehouseId) continue;
        const qty = Math.abs(num(line.qty));
        const rate = num(product?.purchase_rate || product?.purchase_price || line.rate);
        events.push({
          date,
          productId,
          qty: spec.sign * qty,
          amount: Math.abs(num(line.amount)),
          value: spec.sign * qty * rate,
          type: spec.type,
          doc: docNo,
          party,
          href,
          billId: spec.bill ? String(doc.id || "") : "",
          pending: isPending,
        });
      }
    }
  }

  pushLines(sales, {
    dateKey: "invoice_date",
    lineKeys: ["lines", "items", "sale_invoice_items"],
    type: "Sale",
    sign: -1,
    no: (row) => String(row.invoice_no || "—"),
    href: (row) => (row.id ? `/sales/invoices/${row.id}` : ""),
    bill: true,
  });
  pushLines(purchases, {
    dateKey: "invoice_date",
    lineKeys: ["lines", "items", "purchase_invoice_items"],
    type: "Purchase",
    sign: 1,
    no: (row) => {
      const bill = String(row.supplier_bill_no || "").trim();
      return bill ? `${row.invoice_no || ""} · ${bill}` : String(row.invoice_no || "—");
    },
    href: (row) => (row.id ? `/purchases/invoices/${row.id}` : ""),
    bill: true,
  });
  pushLines(saleReturns, {
    dateKey: "return_date",
    lineKeys: ["lines", "items", "sale_return_items"],
    type: "Sale return",
    sign: 1,
    no: (row) => String(row.return_no || row.doc_no || "—"),
    href: (row) => (row.id ? `/sales/returns/${row.id}` : ""),
  });
  pushLines(purchaseReturns, {
    dateKey: "return_date",
    lineKeys: ["lines", "items", "purchase_return_items"],
    type: "Purchase return",
    sign: -1,
    no: (row) => String(row.return_no || row.doc_no || "—"),
    href: (row) => (row.id ? `/purchases/returns/${row.id}` : ""),
  });
  pushLines(claims, {
    dateKey: "claim_date",
    lineKeys: ["lines", "items", "expiry_claim_items"],
    type: "Expiry claim",
    sign: -1,
    no: (row) => String(row.claim_no || row.doc_no || "—"),
    href: () => "/inventory/expiry?tab=claims",
  });

  const currentQty = new Map<string, number>();
  for (const row of stock) {
    if (String(row.warehouse_id || "") !== warehouseId) continue;
    const productId = String(row.product_id || "");
    currentQty.set(productId, (currentQty.get(productId) || 0) + num(row.qty));
  }
  for (const event of events) {
    if (!event.pending || !event.productId) continue;
    currentQty.set(
      event.productId,
      (currentQty.get(event.productId) || 0) + event.qty,
    );
  }

  const rateOf = (productId: string) =>
    num(products.get(productId)?.purchase_rate || products.get(productId)?.purchase_price);

  let openingQty = 0;
  let openingValue = 0;
  let closingQty = 0;
  let closingValue = 0;
  const productIds = new Set<string>([
    ...currentQty.keys(),
    ...events.map((event) => event.productId).filter(Boolean),
  ]);
  for (const productId of productIds) {
    const current = currentQty.get(productId) || 0;
    const rate = rateOf(productId);
    let afterFrom = 0;
    let afterTo = 0;
    for (const event of events) {
      if (event.productId !== productId) continue;
      if (event.date >= from) afterFrom += event.qty;
      if (event.date > to) afterTo += event.qty;
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
  const bucket = (name: string) => {
    const cur = buckets.get(name) || {
      qtyIn: 0,
      qtyOut: 0,
      value: 0,
      amount: 0,
      bills: new Set<string>(),
    };
    buckets.set(name, cur);
    return cur;
  };

  const lines: Array<Row & { _sort: string }> = [];
  for (const event of events) {
    if (event.date < from || event.date > to) continue;
    const slot = bucket(event.type);
    if (event.qty >= 0) slot.qtyIn += event.qty;
    else slot.qtyOut += Math.abs(event.qty);
    slot.value += event.value;
    slot.amount += event.amount;
    if (event.billId) slot.bills.add(event.billId);
    lines.push({
      _sort: `${event.date}|${event.type}|${event.doc}`,
      Date: event.date,
      Type: event.type,
      Document: event.doc,
      "Vendor / customer": event.party,
      Qty: event.qty,
      "Purchase value": event.value,
      Amount: event.amount,
      _href: event.href,
    });
  }
  lines.sort((a, b) => String(a._sort).localeCompare(String(b._sort)));

  const order = [
    "Purchase",
    "Sale return",
    "Sale",
    "Purchase return",
    "Expiry claim",
  ];
  const summary: Row[] = [
    {
      Line: "Opening stock",
      Bills: "",
      "Qty in": openingQty,
      "Qty out": "",
      "Purchase value": openingValue,
      Amount: "",
    },
  ];
  const names = [
    ...order.filter((name) => buckets.has(name)),
    ...[...buckets.keys()].filter((name) => !order.includes(name)),
  ];
  for (const name of names) {
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
    warehouseName,
    openingQty,
    openingValue,
    closingQty,
    closingValue,
    purchaseQty: purchase?.qtyIn || 0,
    purchaseAmount: purchase?.amount || 0,
    saleQty: sale?.qtyOut || 0,
    saleAmount: sale?.amount || 0,
    summary,
    lines: lines.map(({ _sort: _ignored, ...row }) => row),
  };
}

export type SaleOrderLine = {
  id: string;
  product_id: string;
  product_code: string | null;
  product_name: string | null;
  qty: number;
  rate: number;
  amount: number;
  status: string;
  warehouse_id: string;
  warehouse_name: string;
  sale_invoice_id: string | null;
};

export type SaleOrderCompanyBill = {
  warehouseId: string;
  name: string;
  amount: number;
  qty: number;
  status: "open" | "fulfilled" | "mixed";
  invoiceId: string | null;
};

export type SaleOrderListRow = {
  id: string;
  orderNo: string;
  orderDate: string;
  status: string;
  note: string | null;
  salesmanId: string | null;
  salesmanName: string;
  partyId: string;
  partyName: string;
  qty: number;
  amount: number;
  companies: string[];
  companyBills: SaleOrderCompanyBill[];
};

export type SaleOrderDetail = SaleOrderListRow & {
  lines: SaleOrderLine[];
  invoiceIds: string[];
};

type PartyEmbed = { id?: string; party_code: string; name_en: string } | { id?: string; party_code: string; name_en: string }[] | null;
type SalesmanEmbed = { full_name: string } | { full_name: string }[] | null;
type WarehouseEmbed = { name: string } | { name: string }[] | null;

export type SaleOrderQueryRow = {
  id: string;
  order_no: string;
  order_date: string;
  status: string;
  note: string | null;
  salesman_id: string | null;
  party_id: string;
  fulfilled_invoice_ids: string[] | null;
  parties: PartyEmbed;
  salesmen: SalesmanEmbed;
  sale_order_lines: Array<{
    id: string;
    product_id: string;
    product_code: string | null;
    product_name: string | null;
    qty: number | string;
    rate: number | string;
    amount: number | string;
    status: string;
    warehouse_id: string;
    sale_invoice_id: string | null;
    warehouses: WarehouseEmbed;
  }> | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

export function mapSaleOrder(row: SaleOrderQueryRow): SaleOrderDetail {
  const party = one(row.parties);
  const salesman = one(row.salesmen);
  const lines = (row.sale_order_lines || []).map((line) => ({
    id: line.id,
    product_id: line.product_id,
    product_code: line.product_code,
    product_name: line.product_name,
    qty: Number(line.qty || 0),
    rate: Number(line.rate || 0),
    amount: Number(line.amount || 0),
    status: line.status,
    warehouse_id: line.warehouse_id,
    warehouse_name: one(line.warehouses)?.name || "Company",
    sale_invoice_id: line.sale_invoice_id,
  }));
  const companies = [...new Set(lines.map((line) => line.warehouse_name))];
  const billMap = new Map<string, SaleOrderCompanyBill>();
  for (const line of lines) {
    const current = billMap.get(line.warehouse_id);
    if (!current) {
      billMap.set(line.warehouse_id, {
        warehouseId: line.warehouse_id,
        name: line.warehouse_name,
        amount: line.amount,
        qty: line.qty,
        status: line.status === "fulfilled" ? "fulfilled" : "open",
        invoiceId: line.sale_invoice_id,
      });
      continue;
    }
    current.amount += line.amount;
    current.qty += line.qty;
    if (!current.invoiceId && line.sale_invoice_id) {
      current.invoiceId = line.sale_invoice_id;
    }
    if (
      (current.status === "open" && line.status === "fulfilled") ||
      (current.status === "fulfilled" && line.status === "open")
    ) {
      current.status = "mixed";
    }
  }
  return {
    id: row.id,
    orderNo: row.order_no,
    orderDate: row.order_date,
    status: row.status,
    note: row.note,
    salesmanId: row.salesman_id,
    salesmanName: salesman?.full_name || "Unassigned",
    partyId: row.party_id,
    partyName: party ? `${party.party_code} ${party.name_en}` : "Customer",
    qty: lines.reduce((sum, line) => sum + line.qty, 0),
    amount: lines.reduce((sum, line) => sum + line.amount, 0),
    companies,
    companyBills: [...billMap.values()],
    lines,
    invoiceIds: row.fulfilled_invoice_ids || [],
  };
}

export const SALE_ORDER_SELECT =
  "id, order_no, order_date, status, note, salesman_id, party_id, fulfilled_invoice_ids, parties!sale_orders_party_id_fkey(party_code, name_en), salesmen!sale_orders_salesman_id_fkey(full_name), sale_order_lines(id, product_id, product_code, product_name, qty, rate, amount, status, warehouse_id, sale_invoice_id, warehouses(name))";

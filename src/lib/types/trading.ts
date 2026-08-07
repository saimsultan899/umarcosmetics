export type PaymentType = "cash" | "credit" | "partial";
export type DocStatus = "draft" | "posted" | "cancelled";

export type LineItemDraft = {
  key: string;
  product_id: string;
  product_code: string;
  product_name: string;
  qty: string;
  rate: string;
  discount: string;
  scheme: string;
  amount: number;
};

export type SaleInvoice = {
  id: string;
  company_id: string;
  invoice_no: string;
  invoice_date: string;
  party_id: string;
  warehouse_id: string;
  payment_type: PaymentType;
  subtotal: number;
  discount_total: number;
  grand_total: number;
  amount_paid: number;
  narration: string | null;
  status: DocStatus;
  route: string | null;
  city: string | null;
  parties?: { name_en: string; party_code: string } | null;
  warehouses?: { name: string } | null;
};

export type PurchaseInvoice = {
  id: string;
  company_id: string;
  invoice_no: string;
  supplier_bill_no: string | null;
  invoice_date: string;
  party_id: string;
  warehouse_id: string;
  subtotal: number;
  discount_total: number;
  grand_total: number;
  narration: string | null;
  status: DocStatus;
  parties?: { name_en: string; party_code: string } | null;
  warehouses?: { name: string } | null;
};

export type StockTransfer = {
  id: string;
  company_id: string;
  transfer_no: string;
  transfer_date: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  narration: string | null;
  status: DocStatus;
  from_warehouse?: { name: string } | null;
  to_warehouse?: { name: string } | null;
};

export function calcLineAmount(qty: string, rate: string, discount: string) {
  const q = Number(qty || 0);
  const r = Number(rate || 0);
  const d = Number(discount || 0);
  return Math.max(0, q * r - d);
}

export function emptyLine(): LineItemDraft {
  return {
    key: crypto.randomUUID(),
    product_id: "",
    product_code: "",
    product_name: "",
    qty: "1",
    rate: "0",
    discount: "0",
    scheme: "",
    amount: 0,
  };
}

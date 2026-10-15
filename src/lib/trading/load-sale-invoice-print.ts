import type { SalePrintLine } from "@/components/trading/sale-invoice-print";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SaleInvoicePrintData = {
  id: string;
  companyName: string;
  companyPhone: string | null;
  organizationName: string | null;
  companyId: string;
  docNo: string;
  date: string;
  printedAt: string | null;
  partyCode: string | null;
  partyName: string | null;
  partyOwner: string | null;
  partyPhone: string | null;
  partyMobile: string | null;
  sector: string | null;
  salesmanLabel: string | null;
  lines: SalePrintLine[];
  subtotal: number;
  tradeDiscount: number;
  extraDiscount: number;
  billAmount: number;
  paid: number;
  paymentType: string;
  previousPayment: number;
  previousBalance: number;
  preparedBy: string | null;
  isWalkIn: boolean;
  status: string | null;
};

type PartyRow = {
  name_en?: string | null;
  party_code?: string | null;
  phone?: string | null;
  mobile?: string | null;
  contact_person?: string | null;
  route?: string | null;
  head?: string | null;
  city?: string | null;
};

type SalesmanRow = {
  full_name?: string | null;
  phone?: string | null;
};

/** Recoveries on or before the bill date count as last paid (same-day included). */
function isRecoveryForBillPrint(invoiceDate: string, recoveryDate: string) {
  return recoveryDate <= invoiceDate;
}

export async function loadSaleInvoicePrintData(
  supabase: SupabaseClient,
  opts: {
    companyId: string;
    companyName: string;
    companyPhone?: string | null;
    organizationName?: string | null;
    invoiceId: string;
    /** Prefer company.prepared_by from settings; fallback is last resort. */
    preparedByFallback?: string | null;
  },
): Promise<SaleInvoicePrintData | null> {
  const [{ data: invoice }, { data: items }] = await Promise.all([
    supabase
      .from("sale_invoices")
      .select(
        "*, parties(name_en, party_code, address, city, phone, mobile, contact_person, route, head), warehouses(name), salesman:salesmen!sale_invoices_salesman_id_fkey(full_name, phone)",
      )
      .eq("id", opts.invoiceId)
      .eq("company_id", opts.companyId)
      .maybeSingle(),
    supabase
      .from("sale_invoice_items")
      .select("*")
      .eq("sale_invoice_id", opts.invoiceId)
      .order("sort_order"),
  ]);

  if (!invoice) return null;

  const balancePromise = (async () => {
    const next = await supabase.rpc("get_party_balance_before_sale", {
      p_company_id: opts.companyId,
      p_party_id: invoice.party_id,
      p_as_of: invoice.invoice_date,
      p_before: invoice.created_at,
      p_sale_invoice_id: invoice.id,
    });
    if (!next.error) return Number(next.data || 0);
    const fallback = await supabase.rpc("get_party_balance_before", {
      p_company_id: opts.companyId,
      p_party_id: invoice.party_id,
      p_as_of: invoice.invoice_date,
      p_before: invoice.created_at,
    });
    return Number(fallback.data || 0);
  })();

  const [{ data: recoveryRows }, previousBalance] = await Promise.all([
    supabase
      .from("recoveries")
      .select("recovery_date, amount, created_at")
      .eq("company_id", opts.companyId)
      .eq("party_id", invoice.party_id)
      .lte("recovery_date", invoice.invoice_date)
      .order("recovery_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(20),
    balancePromise,
  ]);

  const billAmount = Number(invoice.grand_total || 0);
  const paidOnThisBill = Number(invoice.amount_paid || 0);
  const paymentType = String(invoice.payment_type || "credit");

  const party = invoice.parties as PartyRow | PartyRow[] | null;
  const partyObj = Array.isArray(party) ? party[0] || null : party;

  const isWalkIn =
    String(partyObj?.party_code || "").toUpperCase() === "WALKIN";

  let lastPaidAmount = 0;
  if (!isWalkIn) {
    for (const row of recoveryRows || []) {
      if (!isRecoveryForBillPrint(invoice.invoice_date, row.recovery_date)) {
        continue;
      }
      const amount = Number(row.amount || 0);
      if (amount > 0) {
        lastPaidAmount = amount;
        break;
      }
    }
  }

  const salesman = invoice.salesman as SalesmanRow | SalesmanRow[] | null;
  const salesmanObj = Array.isArray(salesman) ? salesman[0] || null : salesman;

  const salesmanLabel = [salesmanObj?.full_name, salesmanObj?.phone]
    .filter(Boolean)
    .join(" ");

  const sector = partyObj?.route || invoice.route || null;

  return {
    id: String(invoice.id),
    companyName: opts.companyName,
    companyPhone: opts.companyPhone ?? null,
    organizationName: opts.organizationName ?? null,
    companyId: opts.companyId,
    docNo: String(invoice.invoice_no || invoice.id),
    date: String(invoice.invoice_date || ""),
    printedAt: invoice.created_at ?? null,
    partyCode: partyObj?.party_code ?? null,
    partyName: partyObj?.name_en ?? null,
    partyOwner: partyObj?.contact_person ?? null,
    partyPhone: partyObj?.phone ?? null,
    partyMobile: partyObj?.mobile ?? null,
    sector: sector || invoice.route || null,
    salesmanLabel: salesmanLabel || null,
    lines: (items || []).map((i) => ({
      product_code: i.product_code,
      product_name: i.product_name,
      qty: Number(i.qty),
      bonus: Number(i.bonus_qty || 0),
      scheme: i.scheme,
      tradePrice: Number(i.rate),
      discount: Number(i.discount || 0),
      amount: Number(i.amount),
    })),
    subtotal: Number(invoice.subtotal || 0),
    tradeDiscount: Number(invoice.discount_total || 0),
    extraDiscount: Number(invoice.extra_discount || 0),
    billAmount,
    paid: paidOnThisBill,
    paymentType,
    previousPayment: lastPaidAmount,
    previousBalance: isWalkIn ? 0 : previousBalance,
    preparedBy: opts.preparedByFallback || salesmanObj?.full_name || null,
    isWalkIn,
    status: invoice.status ?? null,
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse and cap selected invoice ids from ?ids=a,b,c */
export function parseSelectedInvoiceIds(
  raw: string | string[] | undefined,
  max = 40,
): string[] {
  const text = Array.isArray(raw) ? raw.join(",") : String(raw || "");
  const ids = text
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((id) => UUID_RE.test(id));
  return [...new Set(ids)].slice(0, max);
}

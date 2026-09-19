import { PartyInsightsView } from "@/components/parties/party-insights-view";
import { requireCompanyContext } from "@/lib/auth";
import type {
  PartyInsightProduct,
  PartyInsightRecovery,
  PartyInsightSale,
} from "@/hooks/use-party-insights";
import { notFound } from "next/navigation";

export default async function PartyInsightsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, company, offline } = await requireCompanyContext();

  if (offline) {
    return (
      <PartyInsightsView
        companyId={company.id}
        partyId={id}
        initialOffline={true}
      />
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  const { data: party } = await supabase
    .from("parties")
    .select("*")
    .eq("company_id", company.id)
    .eq("id", id)
    .maybeSingle();

  if (!party) notFound();

  const [
    { data: balance },
    { data: sales },
    { data: recoveries },
    { data: topProducts },
  ] = await Promise.all([
    supabase.rpc("get_party_balance", {
      p_company_id: company.id,
      p_party_id: id,
      p_as_of: today,
    }),
    supabase
      .from("sale_invoices")
      .select("id, invoice_no, invoice_date, grand_total, amount_paid, payment_type")
      .eq("company_id", company.id)
      .eq("party_id", id)
      .eq("status", "posted")
      .order("invoice_date", { ascending: false })
      .limit(12),
    supabase
      .from("recoveries")
      .select("id, recovery_date, amount, receipt_no, narration")
      .eq("company_id", company.id)
      .eq("party_id", id)
      .order("recovery_date", { ascending: false })
      .limit(10),
    supabase
      .from("sale_invoice_items")
      .select(
        "product_code, product_name, qty, rate, amount, sale_invoices!inner(company_id, party_id, status)",
      )
      .eq("sale_invoices.company_id", company.id)
      .eq("sale_invoices.party_id", id)
      .eq("sale_invoices.status", "posted")
      .limit(200),
  ]);

  const productMap = new Map<string, PartyInsightProduct>();
  for (const row of (topProducts || []) as Array<{
    product_code: string;
    product_name: string;
    qty: number;
    rate: number;
    amount: number;
  }>) {
    const key = row.product_code || row.product_name;
    const prev = productMap.get(key) || {
      code: row.product_code,
      name: row.product_name,
      qty: 0,
      amount: 0,
      lastRate: Number(row.rate || 0),
    };
    prev.qty += Number(row.qty || 0);
    prev.amount += Number(row.amount || 0);
    prev.lastRate = Number(row.rate || 0);
    productMap.set(key, prev);
  }
  const products = Array.from(productMap.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  const bal = Number(balance || 0);

  return (
    <PartyInsightsView
      companyId={company.id}
      partyId={id}
      initialParty={party}
      initialBalance={bal}
      initialSales={(sales || []) as PartyInsightSale[]}
      initialRecoveries={(recoveries || []) as PartyInsightRecovery[]}
      initialProducts={products}
      initialOffline={false}
    />
  );
}

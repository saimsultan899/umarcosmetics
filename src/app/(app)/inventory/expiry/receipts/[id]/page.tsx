import { PrintDocument } from "@/components/trading/print-document";
import { requireCompanyContext } from "@/lib/auth";
import { formatPkr } from "@/lib/utils";
import { notFound } from "next/navigation";

export default async function ExpiryReceiptDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const autoPrint = sp.print === "1" || sp.print === "true";
  const { supabase, company } = await requireCompanyContext();

  const { data: doc } = await supabase
    .from("expiry_receipts")
    .select("*, parties(name_en, party_code)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();

  if (!doc) notFound();

  const { data: items } = await supabase
    .from("expiry_receipt_items")
    .select("*")
    .eq("receipt_id", id)
    .order("sort_order");

  const party = Array.isArray(doc.parties) ? doc.parties[0] : doc.parties;

  return (
    <PrintDocument
      companyName={company.name}
      companyAddress={[company.address, company.city].filter(Boolean).join(", ")}
      title="Expiry Warehouse — Customer Return"
      docNo={doc.receipt_no}
      date={doc.receipt_date}
      printedAt={doc.created_at}
      partyName={party?.name_en}
      partyCode={party?.party_code}
      extraMeta={
        doc.period_from && doc.period_to
          ? [{ label: "Sold between", value: `${doc.period_from} → ${doc.period_to}` }]
          : []
      }
      lines={(items || []).map((i) => ({
        product_code: i.product_code,
        product_name: i.product_name,
        qty: Number(i.qty),
        rate: Number(i.rate),
        amount: Number(i.amount),
      }))}
      totals={[
        { label: "Customer credit", value: formatPkr(doc.grand_total), strong: true },
      ]}
      autoPrint={autoPrint}
    />
  );
}

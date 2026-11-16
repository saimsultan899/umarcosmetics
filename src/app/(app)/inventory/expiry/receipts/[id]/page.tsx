import { PrintDocument } from "@/components/trading/print-document";
import { requireCompanyContext } from "@/lib/auth";
import { formatPkr } from "@/lib/utils";
import { notFound } from "next/navigation";

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Compact date for Sold between meta (10-Jun-26). */
function formatPeriodShort(iso: string) {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getDate()).padStart(2, "0")}-${SHORT_MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
}

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
  const { supabase, company, offline } = await requireCompanyContext();

  if (offline) {
    const { renderOfflineDocument } = await import(
      "@/lib/offline/render-offline-page"
    );
    return renderOfflineDocument(
      "expiry_receipt",
      company,
      id,
      "/inventory/expiry/receipts",
      autoPrint,
    );
  }

  const { data: doc } = await supabase
    .from("expiry_receipts")
    .select("*, parties(name_en, party_code, phone, mobile)")
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
      companyPhone={company.phone}
      title={
        !party
          ? "Expiry Return — No party"
          : doc.balance_only
            ? "Expiry Return — Old bill"
            : "Expiry Warehouse — Customer Return"
      }
      docNo={doc.receipt_no}
      date={doc.receipt_date}
      printedAt={doc.created_at}
      backHref="/inventory/expiry/receipts"
      partyName={party?.name_en || "No party"}
      partyCode={party?.party_code}
      partyPhone={party?.phone}
      partyMobile={party?.mobile}
      extraMeta={[
        ...(doc.period_from && doc.period_to
          ? [
              {
                label: "Sold between",
                value: `${formatPeriodShort(doc.period_from)} → ${formatPeriodShort(doc.period_to)}`,
              },
            ]
          : []),
        {
          label: "Stock treatment",
          value: doc.balance_only
            ? "Old bill — ledger cut and added to expiry stock for claim"
            : "Added to expiry stock (available for company claim)",
        },
      ]}
      lines={(items || []).map((i) => ({
        product_code: i.product_code,
        product_name: i.product_name,
        qty: Number(i.qty),
        rate: Number(i.rate),
        amount: Number(i.amount),
      }))}
      totals={[
        { label: "Recover", value: formatPkr(doc.subtotal) },
        ...(Number(doc.gst_amount || 0) > 0
          ? [
              {
                label:
                  doc.gst_mode === "percent"
                    ? `GST ${Number(doc.gst_input || 0)}%`
                    : "GST",
                value: formatPkr(doc.gst_amount),
              },
            ]
          : []),
        {
          label: !party
            ? "Bill (no customer ledger)"
            : doc.balance_only
              ? "Amount cut from customer balance"
              : "Cut from customer ledger",
          value: formatPkr(doc.grand_total),
          strong: true,
        },
      ]}
      autoPrint={autoPrint}
    />
  );
}

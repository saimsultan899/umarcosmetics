import { ExpirySettleForm } from "@/components/expiry/expiry-settle-form";
import { PrintDocument } from "@/components/trading/print-document";
import { requireCompanyContext } from "@/lib/auth";
import { formatPkr } from "@/lib/utils";
import { notFound } from "next/navigation";

export default async function ExpiryClaimDetailPage({
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
    .from("expiry_claims")
    .select("*, parties(name_en, party_code), warehouses(name)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();

  if (!doc) notFound();

  const { data: items } = await supabase
    .from("expiry_claim_items")
    .select("*")
    .eq("claim_id", id)
    .order("sort_order");

  const party = Array.isArray(doc.parties) ? doc.parties[0] : doc.parties;
  const warehouse = Array.isArray(doc.warehouses)
    ? doc.warehouses[0]
    : doc.warehouses;
  const isOpen = doc.claim_status === "open";

  return (
    <div className="space-y-6">
      <PrintDocument
        companyName={company.name}
        companyAddress={[company.address, company.city].filter(Boolean).join(", ")}
        title="Expiry Warehouse — Vendor Claim"
        docNo={doc.claim_no}
        date={doc.claim_date}
        printedAt={doc.created_at}
        partyName={party?.name_en}
        partyCode={party?.party_code}
        warehouseName={warehouse?.name}
        extraMeta={[{ label: "Status", value: String(doc.claim_status || "open") }]}
        lines={(items || []).map((i) => ({
          product_code: i.product_code,
          product_name: i.product_name,
          qty: Number(i.qty),
          rate: Number(i.rate),
          amount: Number(i.amount),
        }))}
        totals={[
          { label: "Claim amount", value: formatPkr(doc.grand_total), strong: true },
          ...(isOpen
            ? []
            : [
                { label: "Accepted", value: formatPkr(doc.accepted_amount) },
                { label: "Rejected / returned", value: formatPkr(doc.rejected_amount) },
              ]),
        ]}
        autoPrint={autoPrint}
      />

      {isOpen ? (
        <ExpirySettleForm
          companyId={company.id}
          organizationId={company.organization_id}
          claimId={doc.id}
          lines={(items || []).map((i) => ({
            id: i.id,
            product_code: i.product_code,
            product_name: i.product_name,
            qty: Number(i.qty),
            amount: Number(i.amount),
          }))}
        />
      ) : null}
    </div>
  );
}

import { PrintDocument } from "@/components/trading/print-document";
import { requireCompanyContext } from "@/lib/auth";
import { formatPkr } from "@/lib/utils";
import { notFound } from "next/navigation";

export async function VoucherDetail({
  id,
  expectedType,
  title,
}: {
  id: string;
  expectedType: "CR" | "CP" | "JV";
  title: string;
}) {
  const { supabase, company } = await requireCompanyContext();

  const { data: voucher } = await supabase
    .from("vouchers")
    .select("*")
    .eq("id", id)
    .eq("company_id", company.id)
    .eq("voucher_type", expectedType)
    .maybeSingle();

  if (!voucher) notFound();

  const [{ data: lines }, { data: parties }] = await Promise.all([
    supabase
      .from("voucher_lines")
      .select("*")
      .eq("voucher_id", id)
      .order("sort_order"),
    supabase
      .from("parties")
      .select("id, party_code, name_en")
      .eq("company_id", company.id),
  ]);

  const partyMap = new Map((parties || []).map((p) => [p.id, p]));

  const printLines =
    expectedType === "JV"
      ? (lines || []).map((l) => {
          const debit = partyMap.get(l.debit_party_id || "");
          const credit = partyMap.get(l.credit_party_id || "");
          return {
            product_code: debit?.party_code || "—",
            product_name: `Dr ${debit?.name_en || "?"} / Cr ${credit?.name_en || "?"}${
              l.narration ? ` — ${l.narration}` : ""
            }`,
            qty: 1,
            amount: Number(l.amount),
          };
        })
      : (lines || []).map((l) => {
          const party = partyMap.get(l.party_id || "");
          return {
            product_code: party?.party_code || "—",
            product_name: `${party?.name_en || "—"}${l.narration ? ` — ${l.narration}` : ""}`,
            qty: 1,
            amount: Number(l.amount),
          };
        });

  return (
    <PrintDocument
      companyName={company.name}
      companyAddress={[company.address, company.city].filter(Boolean).join(", ")}
      title={title}
      docNo={voucher.voucher_no}
      date={voucher.voucher_date}
      extraMeta={
        voucher.narration ? [{ label: "Narration", value: voucher.narration }] : []
      }
      lines={printLines}
      totals={[{ label: "Total amount", value: formatPkr(voucher.total_amount) }]}
    />
  );
}

import { FieldHeader, FieldLinkButton } from "@/components/field/field-frame";
import { FieldPurchaseTable, type FieldPurchaseRow } from "@/components/field/field-purchase-table";
import { effectivePermissions } from "@/lib/access/permissions";
import { requireCompanyContext } from "@/lib/auth";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import { redirect } from "next/navigation";

type PurchaseRow = {
  id: string;
  invoice_no: string;
  invoice_date: string;
  grand_total: number;
  parties: { party_code: string; name_en: string } | { party_code: string; name_en: string }[] | null;
};

export default async function FieldPurchasesPage() {
  const { supabase, company, membership, offline } = await requireCompanyContext();
  const permissions = effectivePermissions(membership);
  if (membership?.role === "salesman" && !permissions.includes("create_purchases")) {
    redirect("/field");
  }
  if (offline) {
    return (
      <p className="rounded-[var(--radius)] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Purchases need a connection.
      </p>
    );
  }

  const data = await fetchAllPages<PurchaseRow>((from, to) =>
    supabase
      .from("purchase_invoices")
      .select("id, invoice_no, invoice_date, grand_total, parties(party_code, name_en)")
      .eq("company_id", company.id)
      .neq("status", "cancelled")
      .order("invoice_date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  );

  const rows: FieldPurchaseRow[] = data.map((row) => {
    const party = Array.isArray(row.parties) ? row.parties[0] : row.parties;
    return {
      id: row.id,
      invoice_no: row.invoice_no,
      invoice_date: row.invoice_date,
      grand_total: Number(row.grand_total || 0),
      vendor: party ? `${party.party_code} ${party.name_en}` : "",
    };
  });

  return (
    <div className="animate-rise space-y-5">
      <FieldHeader
        title="Purchases"
        description="Purchase bills for this company. New purchase uses the full purchase invoice."
        actions={
          <FieldLinkButton href="/purchases/invoices" tone="solid">
            New purchase
          </FieldLinkButton>
        }
      />
      <FieldPurchaseTable rows={rows} />
    </div>
  );
}

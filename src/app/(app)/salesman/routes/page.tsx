import { SectorSheetTable } from "@/components/reports/sector-sheet-table";
import { requireCompanyContext } from "@/lib/auth";
import { PrintButton } from "@/components/ui/print-button";

export default async function RouteSheetsPage() {
  const { supabase, company } = await requireCompanyContext();
  const { data: sheet } = await supabase.rpc("get_recovery_sheet", {
    p_company_id: company.id,
    p_as_of: new Date().toISOString().slice(0, 10),
    p_city: null,
    p_route: null,
  });

  const rows = (
    (sheet || []) as Array<{
      party_id: string;
      party_code: string;
      name_en: string;
      city: string | null;
      route: string | null;
      balance: number;
    }>
  ).filter((r) => Number(r.balance) > 0.005);

  return (
    <div className="animate-rise space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Sector sheets
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Printable dues list for salesman market visits
          </p>
        </div>
        <PrintButton label="Print sector sheet" />
      </div>

      <SectorSheetTable rows={rows} companyName={company.name} />
    </div>
  );
}

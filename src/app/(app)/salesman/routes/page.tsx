import { requireCompanyContext } from "@/lib/auth";
import { formatPkr } from "@/lib/utils";
import { PrintButton } from "@/components/ui/print-button";

export default async function RouteSheetsPage() {
  const { supabase, company } = await requireCompanyContext();
  const { data: sheet } = await supabase.rpc("get_recovery_sheet", {
    p_company_id: company.id,
    p_as_of: new Date().toISOString().slice(0, 10),
    p_city: null,
    p_route: null,
  });

  const rows = ((sheet || []) as Array<{
    party_id: string;
    party_code: string;
    name_en: string;
    city: string | null;
    route: string | null;
    balance: number;
  }>).filter((r) => Number(r.balance) > 0.005);

  return (
    <div className="animate-rise space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Route sheets
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Printable dues list for salesman market visits
          </p>
        </div>
        <PrintButton label="Print route sheet" />
      </div>

      <div className="print-sheet table-shell">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <p className="font-semibold">Route Sheet — {company.name}</p>
          <p className="text-xs text-[var(--muted)]">
            {new Date().toLocaleDateString()}
          </p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Shop</th>
              <th>Route / City</th>
              <th>Balance</th>
              <th>Rec</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((r) => (
                <tr key={r.party_id}>
                  <td className="font-medium">{r.party_code}</td>
                  <td>{r.name_en}</td>
                  <td className="text-[var(--muted)]">
                    {[r.route, r.city].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="font-semibold text-rose-700">
                    {formatPkr(r.balance)} Dr
                  </td>
                  <td />
                  <td />
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="py-8 text-center text-[var(--muted)]">
                  No dues to print.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

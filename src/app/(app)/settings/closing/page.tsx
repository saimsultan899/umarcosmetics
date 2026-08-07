import { requireCompanyContext } from "@/lib/auth";
import { formatPkr } from "@/lib/utils";
import Link from "next/link";

export default async function NightClosingPage() {
  const { supabase, company } = await requireCompanyContext();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: summary }, { data: closings }] = await Promise.all([
    supabase.rpc("get_day_closing_summary", {
      p_company_id: company.id,
      p_date: today,
    }),
    supabase
      .from("day_closings")
      .select("*")
      .eq("company_id", company.id)
      .order("closing_date", { ascending: false })
      .limit(14),
  ]);

  const s = (summary || {}) as Record<string, number>;

  return (
    <div className="animate-rise space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Night closing
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            End-of-day totals for {company.name}
          </p>
        </div>
        <Link
          href="/settings/sync"
          className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white"
        >
          Open sync & close
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Sales", s.sales_total],
          ["Cash/Paid", s.cash_sales],
          ["Credit", s.credit_sales],
          ["Recoveries", s.recoveries_total],
          ["Purchases", s.purchases_total],
        ].map(([label, value]) => (
          <div key={String(label)} className="stat-tile">
            <p className="text-xs uppercase text-[var(--muted)]">{label}</p>
            <p className="mt-2 text-lg font-semibold">{formatPkr(Number(value || 0))}</p>
          </div>
        ))}
      </div>

      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Sales</th>
              <th>Recoveries</th>
              <th>Purchases</th>
              <th>Saved at</th>
            </tr>
          </thead>
          <tbody>
            {(closings || []).length ? (
              closings!.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.closing_date}</td>
                  <td>{formatPkr(c.sales_total)}</td>
                  <td>{formatPkr(c.recoveries_total)}</td>
                  <td>{formatPkr(c.purchases_total)}</td>
                  <td className="text-[var(--muted)]">
                    {new Date(c.created_at).toLocaleString()}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="py-8 text-center text-[var(--muted)]">
                  No closings saved yet. Use Sync & night closing.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

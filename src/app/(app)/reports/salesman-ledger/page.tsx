import { SalesmanLedgerView } from "@/components/reports/salesman-ledger-view";
import { requireCompanyContext } from "@/lib/auth";
import { fetchCompanySalesmen } from "@/lib/queries/salesmen";
import { buildSalesmanLedger } from "@/lib/reports/salesman-ledger";
import { localDateIso, monthStartLocal } from "@/lib/dates";

function today() {
  return localDateIso();
}

function monthStart() {
  return monthStartLocal();
}

export default async function SalesmanLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    salesman?: string;
  }>;
}) {
  const sp = await searchParams;
  const { supabase, company, offline } = await requireCompanyContext();
  const from = sp.from || monthStart();
  const to = sp.to || today();
  const salesmanId = sp.salesman || "";

  if (offline) {
    const { OfflineReportPanel } = await import(
      "@/components/offline/offline-report-panel"
    );
    return (
      <OfflineReportPanel
        kind="salesman_ledger"
        companyId={company.id}
        companyName={company.name}
        from={from}
        to={to}
        salesmanId={salesmanId}
      />
    );
  }

  const [salesmen, ledger] = await Promise.all([
    fetchCompanySalesmen(supabase, company.id),
    buildSalesmanLedger(supabase, {
      companyId: company.id,
      salesmanId,
      from,
      to,
    }),
  ]);

  return (
    <SalesmanLedgerView
      companyName={company.name}
      from={from}
      to={to}
      salesmanId={salesmanId}
      salesmanName={ledger.salesmanName}
      salesmen={salesmen.map((s) => ({
        id: s.user_id,
        name: s.full_name || s.user_id.slice(0, 8),
      }))}
      lines={ledger.lines}
      totals={ledger.totals}
      error={ledger.error}
    />
  );
}

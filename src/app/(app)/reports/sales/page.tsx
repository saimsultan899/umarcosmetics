import { ChartCard } from "@/components/analytics/chart-card";
import { CompareBarChart } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { PartyWiseSalesPrint } from "@/components/reports/party-wise-sales-print";
import { FilterMultiSelect, ReportFilters } from "@/components/reports/report-filters";
import { ReportTypePills } from "@/components/reports/report-type-pills";
import { ReportTable } from "@/components/reports/report-table";
import { requireCompanyContext } from "@/lib/auth";
import { parseReportList } from "@/lib/reports/filter-params";
import {
  buildSaleReport,
  SALE_REPORT_TYPES,
  type SaleReportType,
} from "@/lib/reports/sales-data";
import { localDateIso, monthStartLocal } from "@/lib/dates";
import { FileSpreadsheet, Rows3 } from "lucide-react";

function today() {
  return localDateIso();
}

function monthStart() {
  return monthStartLocal();
}

export default async function SaleReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    from?: string;
    to?: string;
    warehouse?: string;
    party?: string;
    billFrom?: string;
    billTo?: string;
  }>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();
  const selectedTypes = parseReportList(sp.type) as SaleReportType[];
  const types: SaleReportType[] = selectedTypes.length
    ? selectedTypes
    : ["date_wise"];
  const primaryType = types[0];
  const from = sp.from || monthStart();
  const to = sp.to || today();

  const [{ data: warehouses }, { data: parties }] = await Promise.all([
    supabase
      .from("warehouses")
      .select("id, name")
      .eq("company_id", company.id)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("parties")
      .select("id, party_code, name_en")
      .eq("company_id", company.id)
      .eq("is_active", true)
      .order("name_en")
      .limit(500),
  ]);

  const warehouseIds = parseReportList(sp.warehouse);
  const partyIds = parseReportList(sp.party);

  const reportSections: {
    type: SaleReportType;
    label: string;
    rows: Record<string, unknown>[];
  }[] = [];
  let error: string | null = null;
  try {
    for (const type of types) {
      const rows = await buildSaleReport(supabase, {
        companyId: company.id,
        from,
        to,
        type,
        warehouseIds,
        partyIds,
        billFrom: sp.billFrom || undefined,
        billTo: sp.billTo || undefined,
      });
      reportSections.push({
        type,
        label:
          SALE_REPORT_TYPES.find((t) => t.key === type)?.label || "Sale report",
        rows,
      });
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to build report";
  }

  const rows = reportSections.find((s) => s.type === primaryType)?.rows || [];
  const activeLabel =
    types.length === 1
      ? reportSections[0]?.label || "Sale report"
      : `${types.length} reports selected`;

  const primaryMoneyKey = (() => {
    if (!rows.length) return null;
    const keys = Object.keys(rows[0]);
    const priority = ["Amount", "Total", "Grand total", "Profit", "Invoice total"];
    for (const p of priority) {
      const found = keys.find(
        (k) => k.toLowerCase() === p.toLowerCase() && typeof rows[0][k] === "number",
      );
      if (found) return found;
    }
    return null;
  })();
  const numericTotal = primaryMoneyKey
    ? rows.reduce((sum, row) => sum + Number(row[primaryMoneyKey] || 0), 0)
    : 0;
  const chartSample = rows.slice(0, 8).map((row, idx) => {
    const label =
      String(
        row.Date ||
          row.Customer ||
          row.Party ||
          row.Salesman ||
          row.City ||
          row.Sector ||
          row.Product ||
          row.Invoice ||
          `Row ${idx + 1}`,
      ).slice(0, 18);
    const value = primaryMoneyKey ? Number(row[primaryMoneyKey] || 0) : 0;
    return { name: label, value };
  });

  return (
    <div className="animate-rise space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          Sale Reports
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Filtered sales analytics with print / Excel / CSV export
        </p>
      </div>

      <StatsGrid>
        <StatCard
          label="Report rows"
          value={rows.length}
          format="number"
          icon={Rows3}
          hint={activeLabel}
        />
        <StatCard
          label="Highlighted total"
          value={numericTotal}
          format="money"
          icon={FileSpreadsheet}
          tone="brand"
          hint="Sum of main amount columns in this view"
        />
        <StatCard
          label="From"
          value={from}
          tone="neutral"
          hint="Period start"
        />
        <StatCard
          label="To"
          value={to}
          tone="neutral"
          hint="Period end"
        />
      </StatsGrid>

      {!error && chartSample.some((x) => x.value > 0) ? (
        <ChartCard
          title={`${activeLabel} snapshot`}
          subtitle="Visual preview of the first rows — full detail in table below"
        >
          <CompareBarChart data={chartSample} valueLabel="Amount" height={240} />
        </ChartCard>
      ) : null}

      <ReportTypePills options={SALE_REPORT_TYPES} />

      <ReportFilters
        action="/reports/sales"
        defaults={{ from, to, type: types.join(",") }}
        extras={
          <>
            <FilterMultiSelect
              name="warehouse"
              label="Company"
              value={sp.warehouse}
              options={(warehouses || []).map((w) => ({
                value: w.id,
                label: w.name,
              }))}
            />
            <FilterMultiSelect
              name="party"
              label="Customer"
              value={sp.party}
              options={(parties || []).map((p) => ({
                value: p.id,
                label: `${p.party_code} — ${p.name_en}`,
              }))}
            />
            {types.includes("bill_range") ? (
              <>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
                    Bill from
                  </label>
                  <input
                    name="billFrom"
                    defaultValue={sp.billFrom || ""}
                    className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
                    placeholder="SI-0001"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
                    Bill to
                  </label>
                  <input
                    name="billTo"
                    defaultValue={sp.billTo || ""}
                    className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
                    placeholder="SI-9999"
                  />
                </div>
              </>
            ) : null}
          </>
        }
      />

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {reportSections.map((section) => (
        <section
          key={section.type}
          className="space-y-3 border-t border-[var(--border)] pt-6 first:border-t-0 first:pt-0"
        >
          {section.type === "party_wise" ? (
            <PartyWiseSalesPrint
              companyName={company.name}
              from={from}
              to={to}
              rows={section.rows}
              filename={`sale-${section.type}-${from}-${to}`}
            />
          ) : (
            <ReportTable
              title={section.label}
              companyName={company.name}
              subtitle={`${from} to ${to} · ${section.rows.length} rows`}
              rows={section.rows}
              filename={`sale-${section.type}-${from}-${to}`}
            />
          )}
        </section>
      ))}
    </div>
  );
}

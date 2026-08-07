import { ChartCard } from "@/components/analytics/chart-card";
import { CompareBarChart } from "@/components/analytics/charts";
import { StatCard, StatsGrid } from "@/components/analytics/stat-card";
import { FilterSelect, ReportFilters } from "@/components/reports/report-filters";
import { ReportTable } from "@/components/reports/report-table";
import { requireCompanyContext } from "@/lib/auth";
import {
  buildSaleReport,
  SALE_REPORT_TYPES,
  type SaleReportType,
} from "@/lib/reports/sales-data";
import { FileSpreadsheet, Rows3 } from "lucide-react";
import Link from "next/link";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
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
  const type = (sp.type || "date_wise") as SaleReportType;
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

  let rows: Record<string, unknown>[] = [];
  let error: string | null = null;
  try {
    rows = await buildSaleReport(supabase, {
      companyId: company.id,
      from,
      to,
      type,
      warehouseId: sp.warehouse || undefined,
      partyId: sp.party || undefined,
      billFrom: sp.billFrom || undefined,
      billTo: sp.billTo || undefined,
    });
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to build report";
  }

  const activeLabel =
    SALE_REPORT_TYPES.find((t) => t.key === type)?.label || "Sale report";

  const moneyKeys = [
    "Amount",
    "Total",
    "Grand total",
    "grand_total",
    "Cash",
    "Credit",
    "Profit",
    "Sale",
  ];
  const numericTotal = rows.reduce((sum, row) => {
    for (const key of Object.keys(row)) {
      if (
        moneyKeys.some((k) => key.toLowerCase().includes(k.toLowerCase())) &&
        typeof row[key] === "number"
      ) {
        return sum + Number(row[key] || 0);
      }
    }
    return sum;
  }, 0);
  const chartSample = rows.slice(0, 8).map((row, idx) => {
    const label =
      String(
        row.Date ||
          row.Party ||
          row.City ||
          row.Route ||
          row.Product ||
          row.Invoice ||
          `Row ${idx + 1}`,
      ).slice(0, 18);
    let value = 0;
    for (const key of Object.keys(row)) {
      if (
        moneyKeys.some((k) => key.toLowerCase().includes(k.toLowerCase())) &&
        typeof row[key] === "number"
      ) {
        value = Number(row[key] || 0);
        break;
      }
    }
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

      <div className="no-print flex flex-wrap gap-2">
        {SALE_REPORT_TYPES.map((t) => (
          <Link
            key={t.key}
            href={`/reports/sales?type=${t.key}&from=${from}&to=${to}`}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              type === t.key
                ? "bg-[var(--brand)] !text-white"
                : "border border-[var(--border)] bg-white text-[var(--muted)]"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <ReportFilters
        action="/reports/sales"
        defaults={{ from, to, type }}
        extras={
          <>
            <FilterSelect
              name="warehouse"
              label="Warehouse"
              value={sp.warehouse}
              options={(warehouses || []).map((w) => ({
                value: w.id,
                label: w.name,
              }))}
            />
            <FilterSelect
              name="party"
              label="Party"
              value={sp.party}
              options={(parties || []).map((p) => ({
                value: p.id,
                label: `${p.party_code} — ${p.name_en}`,
              }))}
            />
            {type === "bill_range" ? (
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

      <ReportTable
        title={`${activeLabel} — ${company.name}`}
        subtitle={`${from} to ${to} · ${rows.length} rows`}
        rows={rows}
        filename={`sale-${type}-${from}-${to}`}
      />
    </div>
  );
}

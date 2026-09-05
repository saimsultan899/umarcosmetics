import { PageHeading } from "@/components/ui/create-dialog";
import { FilterSelect, ReportFilters } from "@/components/reports/report-filters";
import { ReportTable } from "@/components/reports/report-table";
import { requireCompanyContext } from "@/lib/auth";
import { localDateIso, monthStartLocal } from "@/lib/dates";
import {
  buildExpiryReport,
  EXPIRY_REPORT_VIEWS,
  type ExpiryReportView,
} from "@/lib/reports/expiry-data";
import Link from "next/link";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ExpiryReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    from?: string;
    to?: string;
    warehouse?: string;
  }>;
}) {
  const sp = await searchParams;
  const { supabase, company } = await requireCompanyContext();
  const viewRaw = typeof sp.view === "string" ? sp.view : "returns";
  const view = EXPIRY_REPORT_VIEWS.some((v) => v.key === viewRaw)
    ? (viewRaw as ExpiryReportView)
    : "returns";
  const from = sp.from || monthStartLocal();
  const to = sp.to || localDateIso();
  const warehouseId = sp.warehouse || "";

  const [{ data: warehouses }, rows] = await Promise.all([
    supabase
      .from("warehouses")
      .select("id, name")
      .eq("company_id", company.id)
      .eq("is_active", true)
      .order("name"),
    buildExpiryReport(supabase, {
      companyId: company.id,
      view,
      from,
      to,
      warehouseId: warehouseId || undefined,
    }),
  ]);

  const title =
    EXPIRY_REPORT_VIEWS.find((v) => v.key === view)?.label || "Expiry warehouse";
  const subtitle =
    view === "onhand"
      ? "Current expiry stock held off saleable inventory"
      : `${from} → ${to}`;

  return (
    <div className="animate-rise space-y-6">
      <PageHeading
        title="Expiry warehouse report"
        description="On-hand expired stock, customer returns, and vendor claims — by company."
        actions={
          <Link
            href="/inventory/expiry"
            className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)]"
          >
            Open expiry warehouse
          </Link>
        }
      />

      <div className="no-print flex flex-wrap gap-2">
        {EXPIRY_REPORT_VIEWS.map((v) => (
          <Link
            key={v.key}
            href={`/reports/expiry?view=${v.key}&from=${from}&to=${to}${warehouseId ? `&warehouse=${warehouseId}` : ""}`}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium",
              view === v.key
                ? "bg-[var(--brand)] !text-white"
                : "border border-[var(--border)] bg-white text-[var(--muted)]",
            )}
          >
            {v.label}
          </Link>
        ))}
      </div>

      <ReportFilters
        action="/reports/expiry"
        defaults={{ from, to }}
        extras={
          <>
            <input type="hidden" name="view" value={view} />
            <FilterSelect
              name="warehouse"
              label="Company"
              value={warehouseId}
              options={(warehouses || []).map((w) => ({
                value: w.id,
                label: w.name,
              }))}
              allLabel="All companies"
            />
          </>
        }
      />

      <ReportTable
        title={`Expiry warehouse — ${title}`}
        companyName={company.name}
        subtitle={subtitle}
        rows={rows}
        filename={`expiry-${view}`}
      />
    </div>
  );
}

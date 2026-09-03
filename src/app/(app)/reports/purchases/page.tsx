import { FilterMultiSelect, ReportFilters } from "@/components/reports/report-filters";
import { ReportTypePills } from "@/components/reports/report-type-pills";
import { ReportTable } from "@/components/reports/report-table";
import { requireCompanyContext } from "@/lib/auth";
import { parseReportList } from "@/lib/reports/filter-params";
import {
  buildPurchaseReport,
  PURCHASE_REPORT_TYPES,
  type PurchaseReportType,
} from "@/lib/reports/purchases-data";
import { localDateIso, monthStartLocal } from "@/lib/dates";

function today() {
  return localDateIso();
}

function monthStart() {
  return monthStartLocal();
}

export default async function PurchaseReportsPage({
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
  const selectedTypes = parseReportList(sp.type) as PurchaseReportType[];
  const types: PurchaseReportType[] = selectedTypes.length
    ? selectedTypes
    : ["summary"];
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
      .in("party_subtype", ["supplier", "both"])
      .order("name_en"),
  ]);

  const warehouseIds = parseReportList(sp.warehouse);
  const partyIds = parseReportList(sp.party);

  const reportSections: {
    type: PurchaseReportType;
    label: string;
    rows: Record<string, unknown>[];
  }[] = [];
  let error: string | null = null;
  try {
    for (const type of types) {
      const rows = await buildPurchaseReport(supabase, {
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
          PURCHASE_REPORT_TYPES.find((t) => t.key === type)?.label ||
          "Purchase report",
        rows,
      });
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to build report";
  }

  return (
    <div className="animate-rise space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
          Purchase Reports
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Vendor and item purchase analytics with export
        </p>
      </div>

      <ReportTypePills options={PURCHASE_REPORT_TYPES} />

      <ReportFilters
        action="/reports/purchases"
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
              label="Vendor"
              value={sp.party}
              options={(parties || []).map((p) => ({
                value: p.id,
                label: `${p.party_code} — ${p.name_en}`,
              }))}
            />
            {types.includes("bill_wise") ? (
              <>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase text-[var(--muted)]">
                    Bill from
                  </label>
                  <input
                    name="billFrom"
                    defaultValue={sp.billFrom || ""}
                    className="h-10 w-full rounded-lg border border-[var(--border)] px-3 text-sm"
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
          <ReportTable
            title={section.label}
            companyName={company.name}
            subtitle={`${from} to ${to} · ${section.rows.length} rows`}
            rows={section.rows}
            filename={`purchase-${section.type}-${from}-${to}`}
          />
        </section>
      ))}
    </div>
  );
}

import { FilterMultiSelect, ReportFilters } from "@/components/reports/report-filters";
import { ReportTable } from "@/components/reports/report-table";
import { requireCompanyContext } from "@/lib/auth";
import { parseReportList, reportLinkQuery } from "@/lib/reports/filter-params";
import {
  buildPurchaseReport,
  PURCHASE_REPORT_TYPES,
  type PurchaseReportType,
} from "@/lib/reports/purchases-data";
import Link from "next/link";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
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
  const type = (sp.type || "summary") as PurchaseReportType;
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

  let rows: Record<string, unknown>[] = [];
  let error: string | null = null;
  try {
    rows = await buildPurchaseReport(supabase, {
      companyId: company.id,
      from,
      to,
      type,
      warehouseIds,
      partyIds,
      billFrom: sp.billFrom || undefined,
      billTo: sp.billTo || undefined,
    });
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to build report";
  }

  const activeLabel =
    PURCHASE_REPORT_TYPES.find((t) => t.key === type)?.label || "Purchase report";

  const filterParams = {
    from,
    to,
    warehouse: sp.warehouse,
    party: sp.party,
    billFrom: sp.billFrom,
    billTo: sp.billTo,
  };

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

      <div className="no-print flex flex-wrap gap-2">
        {PURCHASE_REPORT_TYPES.map((t) => (
          <Link
            key={t.key}
            href={`/reports/purchases?${reportLinkQuery(filterParams, { type: t.key }).toString()}`}
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
        action="/reports/purchases"
        defaults={{ from, to, type }}
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
            {type === "bill_wise" ? (
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

      <ReportTable
        title={activeLabel}
        companyName={company.name}
        subtitle={`${from} to ${to} · ${rows.length} rows`}
        rows={rows}
        filename={`purchase-${type}-${from}-${to}`}
      />
    </div>
  );
}

import { PrintDocument } from "@/components/trading/print-document";
import { requireCompanyContext } from "@/lib/auth";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function LoadSheetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, company } = await requireCompanyContext();

  const { data: sheet } = await supabase
    .from("load_sheets")
    .select(
      "*, warehouses(name), load_sheet_items(id, product_code, product_name, qty, sort_order)",
    )
    .eq("company_id", company.id)
    .eq("id", id)
    .maybeSingle();

  if (!sheet) notFound();

  const wh = Array.isArray(sheet.warehouses) ? sheet.warehouses[0] : sheet.warehouses;
  const items = [...(sheet.load_sheet_items || [])].sort(
    (a, b) => (a.sort_order || 0) - (b.sort_order || 0),
  );

  return (
    <div className="animate-rise space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            Van load sheet
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold">
            {sheet.sheet_no}
          </h1>
        </div>
        <Link
          href="/inventory/load-sheets"
          className="rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium"
        >
          Back
        </Link>
      </div>

      <PrintDocument
        companyName={company.name}
        companyAddress={[company.address, company.city].filter(Boolean).join(", ")}
        companyNtn={company.ntn}
        companyPhone={company.phone}
        title="Van Load Sheet"
        docNo={sheet.sheet_no}
        date={sheet.sheet_date}
        warehouseName={wh?.name}
        extraMeta={[
          ...(sheet.vehicle_no
            ? [{ label: "Vehicle", value: sheet.vehicle_no }]
            : []),
          ...(sheet.route ? [{ label: "Route", value: sheet.route }] : []),
        ]}
        lines={items.map((item) => ({
          product_code: item.product_code,
          product_name: item.product_name,
          qty: Number(item.qty),
        }))}
        signatures={["Storekeeper", "Driver / Salesman"]}
        footerNote={sheet.narration ? `Note: ${sheet.narration}` : undefined}
      />
    </div>
  );
}

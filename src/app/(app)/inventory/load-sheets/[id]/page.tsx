import { PrintButton } from "@/components/ui/print-button";
import { requireCompanyContext } from "@/lib/auth";
import { formatNumber } from "@/lib/utils";
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
    <div className="animate-rise space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            Van load sheet
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-semibold">
            {sheet.sheet_no}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {sheet.sheet_date} · {wh?.name || "Warehouse"} ·{" "}
            {[sheet.vehicle_no, sheet.route].filter(Boolean).join(" · ") || "No route"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/inventory/load-sheets"
            className="rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium"
          >
            Back
          </Link>
          <PrintButton label="Print load sheet" />
        </div>
      </div>

      <div className="table-shell print:border-0 print:shadow-none">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Code</th>
              <th>Product</th>
              <th className="text-right">Qty</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.id}>
                <td>{idx + 1}</td>
                <td className="font-medium">{item.product_code}</td>
                <td>{item.product_name}</td>
                <td className="text-right">{formatNumber(item.qty, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sheet.narration ? (
        <p className="text-sm text-[var(--muted)]">Note: {sheet.narration}</p>
      ) : null}
    </div>
  );
}
